class ApiServis {
  constructor(config) {
    this.config = config;
    this.owner = config.REPO_OWNER;
    this.repo = config.REPO_NAME;
    this.projectId = config.FIREBASE_PROJECT_ID;
    this.token = config.GITHUB_TOKEN;
    this.githubBase = config.githubApiBase || 'https://api.github.com';
    this.firebaseBase = 'https://firebasehosting.googleapis.com/v1beta1';
    this.headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
    if (this.token) {
      this.headers['Authorization'] = `Bearer ${this.token}`;
    }
    this._rateLimitReset = 0;
    this._rateLimitRemaining = 5000;
  }

  _updateRateLimitInfo(response) {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');
    if (remaining !== null) this._rateLimitRemaining = parseInt(remaining, 10);
    if (reset !== null) this._rateLimitReset = parseInt(reset, 10) * 1000;
  }

  _calculateWaitTime() {
    const now = Date.now();
    if (this._rateLimitReset > now) {
      return this._rateLimitReset - now + 1000;
    }
    return 0;
  }

  async fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const mergedHeaders = { ...this.headers, ...options.headers };
        const response = await fetch(url, { ...options, headers: mergedHeaders });
        
        this._updateRateLimitInfo(response);
        
        if (response.status === 403) {
          const waitTime = this._calculateWaitTime();
          if (waitTime > 0 && attempt < retries) {
            console.warn(`[ApiServis] Rate limit aşıldı. ${Math.ceil(waitTime / 1000)} sn bekleniyor...`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
          const errorText = await response.text();
          throw new Error(`HTTP 403: ${errorText}`);
        }
        
        if (response.status === 404) {
          throw new Error(`Kaynak bulunamadı: ${url}`);
        }
        
        if (response.status === 422) {
          const errorText = await response.text();
          throw new Error(`HTTP 422: ${errorText}`);
        }
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = backoff * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`[ApiServis] API hatası (deneme ${attempt}/${retries}), ${Math.round(delay)} ms sonra yeniden deneniyor:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // GitHub Actions Workflow Endpoint'leri
  async getWorkflowRuns(perPage = 10, branch = 'main') {
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs?per_page=${perPage}&branch=${branch}`;
    return this.fetchWithRetry(url);
  }

  async getWorkflowRun(runId) {
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}`;
    return this.fetchWithRetry(url);
  }

  async getLatestWorkflowRun() {
    const data = await this.getWorkflowRuns(1);
    return data.workflow_runs?.[0] || null;
  }

  async getWorkflowRunJobs(runId, perPage = 100) {
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/jobs?per_page=${perPage}`;
    const data = await this.fetchWithRetry(url);
    return data.jobs || [];
  }

  async getWorkflowRunLogs(runId) {
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/logs`;
    const response = await fetch(url, { headers: this.headers });
    
    if (!response.ok) {
      if (response.status === 403) {
        throw new Error('Log erişimi için GitHub token yetkisi gerekli (actions:read)');
      }
      throw new Error(`Log indirme hatası: HTTP ${response.status}`);
    }
    
    const blob = await response.blob();
    return await blob.text();
  }

  async getWorkflowRunAttempt(runId, attemptNumber = 1) {
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/attempts/${attemptNumber}`;
    return this.fetchWithRetry(url);
  }

  async rerunWorkflowRun(runId) {
    if (!this.token) {
      throw new Error('Yeniden çalıştırma için GITHUB_TOKEN gerekli');
    }
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/rerun`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers
    });
    
    this._updateRateLimitInfo(response);
    
    if (response.status === 403) {
      throw new Error('Yeniden çalıştırma yetkisi yok (repo yönetici yetkisi gerekli)');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Yeniden çalıştırma hatası: HTTP ${response.status} - ${errorText}`);
    }
    
    return { success: true };
  }

  async rerunFailedJobs(runId) {
    if (!this.token) {
      throw new Error('Yeniden çalıştırma için GITHUB_TOKEN gerekli');
    }
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/rerun-failed-jobs`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers
    });
    
    this._updateRateLimitInfo(response);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Başarısız job'ları yeniden çalıştırma hatası: HTTP ${response.status} - ${errorText}`);
    }
    
    return { success: true };
  }

  async cancelWorkflowRun(runId) {
    if (!this.token) {
      throw new Error('İptal için GITHUB_TOKEN gerekli');
    }
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs/${runId}/cancel`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers
    });
    
    this._updateRateLimitInfo(response);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Workflow iptal hatası: HTTP ${response.status} - ${errorText}`);
    }
    
    return { success: true };
  }

  // Firebase Hosting Endpoint'leri
  async getFirebaseReleases(pageSize = 10) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    const url = `${this.firebaseBase}/projects/${this.projectId}/sites/${this.projectId}/releases?pageSize=${pageSize}`;
    return this.fetchWithRetry(url);
  }

  async getLatestFirebaseRelease() {
    const data = await this.getFirebaseReleases(1);
    return data.releases?.[0] || null;
  }

  async getLastSuccessfulRelease() {
    const data = await this.getFirebaseReleases(50);
    const releases = data.releases || [];
    return releases.find(r => r.type === 'RELEASE' && r.releaseTime) || null;
  }

  async getReleaseDetails(releaseName) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    const url = `${this.firebaseBase}/projects/${this.projectId}/sites/${this.projectId}/releases/${releaseName}`;
    return this.fetchWithRetry(url);
  }

  async triggerRollback(targetReleaseName) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    if (!this.token) {
      throw new Error('GITHUB_TOKEN yapılandırılmamış (Firebase Management API için OAuth gerekli)');
    }
    const url = `${this.firebaseBase}/projects/${this.projectId}/sites/${this.projectId}/releases/${targetReleaseName}:clone`;
    return this.fetchWithRetry(url, { 
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${this.token}` } 
    });
  }

  async deleteRelease(releaseName) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    if (!this.token) {
      throw new Error('GITHUB_TOKEN yapılandırılmamış');
    }
    const url = `${this.firebaseBase}/projects/${this.projectId}/sites/${this.projectId}/releases/${releaseName}`;
    return this.fetchWithRetry(url, { 
      method: 'DELETE', 
      headers: { 'Authorization': `Bearer ${this.token}` } 
    });
  }

  // Tek veri akışı - tüm servis verilerini toleranslı toplar
  async tumVeriyiAl() {
    try {
      const [
        workflowRunsResponse,
        latestRunResponse,
        releasesResponse,
        lastSuccessResponse,
        jobsResponse
      ] = await Promise.allSettled([
        this.getWorkflowRuns(10),
        this.getLatestWorkflowRun(),
        this.getFirebaseReleases(10),
        this.getLastSuccessfulRelease(),
        (async () => {
          const latest = await this.getLatestWorkflowRun();
          if (latest?.id) return this.getWorkflowRunJobs(latest.id);
          return [];
        })()
      ]);

      const workflowRuns = workflowRunsResponse.status === 'fulfilled' 
        ? (workflowRunsResponse.value.workflow_runs || []) 
        : [];
      const latestRun = latestRunResponse.status === 'fulfilled' 
        ? latestRunResponse.value 
        : null;
      const releases = releasesResponse.status === 'fulfilled' 
        ? (releasesResponse.value.releases || []) 
        : [];
      const lastSuccessfulRelease = lastSuccessResponse.status === 'fulfilled' 
        ? lastSuccessResponse.value 
        : null;
      const jobs = jobsResponse.status === 'fulfilled' 
        ? jobsResponse.value 
        : [];

      let workflowDurumu = 'Bilinmiyor';
      let workflowConclusion = 'Bilinmiyor';
      let workflowBaslangic = null;
      let workflowBitis = null;
      let workflowName = null;

      if (latestRun) {
        workflowDurumu = latestRun.status || 'Bilinmiyor';
        workflowConclusion = latestRun.conclusion || 'Bilinmiyor';
        workflowName = latestRun.name || latestRun.display_title || latestRun.workflow_id || 'Bilinmiyor';
        if (latestRun.run_started_at) workflowBaslangic = new Date(latestRun.run_started_at);
        if (latestRun.updated_at) workflowBitis = new Date(latestRun.updated_at);
      }

      const runHistory = workflowRuns.slice(0, 10).map(run => ({
        id: run.id,
        name: run.name || run.display_title || run.workflow_id,
        status: run.status,
        conclusion: run.conclusion,
        run_started_at: run.run_started_at,
        updated_at: run.updated_at,
        head_branch: run.head_branch,
        head_sha: run.head_sha?.substring(0, 7),
        html_url: run.html_url,
        run_number: run.run_number,
        duration_ms: run.run_started_at && run.updated_at 
          ? new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()
          : null
      }));

      const releaseHistory = releases.slice(0, 10).map(release => ({
        name: release.name,
        type: release.type,
        releaseTime: release.releaseTime,
        createTime: release.createTime,
        version: release.version
      }));

      const jobSummary = jobs.length > 0 ? {
        total: jobs.length,
        completed: jobs.filter(j => j.status === 'completed').length,
        in_progress: jobs.filter(j => j.status === 'in_progress').length,
        queued: jobs.filter(j => j.status === 'queued').length,
        failed: jobs.filter(j => j.conclusion === 'failure').length,
        success: jobs.filter(j => j.conclusion === 'success').length,
        skipped: jobs.filter(j => j.conclusion === 'skipped').length,
        jobs: jobs.map(j => ({
          name: j.name,
          status: j.status,
          conclusion: j.conclusion,
          started_at: j.started_at,
          completed_at: j.completed_at,
          steps: j.steps?.length || 0
        }))
      } : null;

      return {
        workflowDurumu,
        workflowConclusion,
        workflowName,
        workflowBaslangic,
        workflowBitis,
        latestRun,
        workflowRuns: runHistory,
        releases: releaseHistory,
        lastSuccessfulRelease,
        rollbackMevcut: !!lastSuccessfulRelease,
        runs: runHistory,
        jobs: jobSummary,
        rollbackInfo: lastSuccessfulRelease ? { 
          reason: 'Otomatik rollback hazır', 
          releaseName: lastSuccessfulRelease.name,
          timestamp: lastSuccessfulRelease.releaseTime ? new Date(lastSuccessfulRelease.releaseTime) : new Date(),
          releaseTime: lastSuccessfulRelease.releaseTime
        } : null,
        _meta: {
          fetchedAt: new Date(),
          partialFailures: [
            workflowRunsResponse.status === 'rejected' && 'workflowRuns',
            latestRunResponse.status === 'rejected' && 'latestRun',
            releasesResponse.status === 'rejected' && 'releases',
            lastSuccessResponse.status === 'rejected' && 'lastSuccessfulRelease',
            jobsResponse.status === 'rejected' && 'jobs'
          ].filter(Boolean)
        }
      };
    } catch (error) {
      console.error('[ApiServis] tumVeriyiAl kritik hata:', error);
      return {
        workflowDurumu: 'Hata',
        workflowConclusion: 'Hata',
        workflowName: null,
        workflowBaslangic: null,
        workflowBitis: null,
        latestRun: null,
        workflowRuns: [],
        releases: [],
        lastSuccessfulRelease: null,
        rollbackMevcut: false,
        runs: [],
        jobs: null,
        rollbackInfo: null,
        _meta: { fetchedAt: new Date(), partialFailures: ['all'], error: error.message }
      };
    }
  }

  // Yardımcı: Rate limit durumunu döndür
  getRateLimitStatus() {
    const now = Date.now();
    return {
      remaining: this._rateLimitRemaining,
      resetAt: this._rateLimitReset,
      secondsUntilReset: this._rateLimitReset > now ? Math.ceil((this._rateLimitReset - now) / 1000) : 0
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiServis;
} else if (typeof window !== 'undefined') {
  window.ApiServis = ApiServis;
}
