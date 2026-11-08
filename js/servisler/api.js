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
  }

  async fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, { ...options, headers: { ...this.headers, ...options.headers } });
        
        if (response.status === 403) {
          const resetHeader = response.headers.get('X-RateLimit-Reset');
          const remaining = response.headers.get('X-RateLimit-Remaining');
          if (remaining === '0' && resetHeader) {
            const resetTime = parseInt(resetHeader, 10) * 1000;
            const waitTime = Math.max(resetTime - Date.now(), 0) + 1000;
            console.warn(`API rate limit aşıldı. ${Math.ceil(waitTime / 1000)} sn bekleniyor.`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
          console.warn(`API yetki hatası (403): ${url}`);
          const errorText = await response.text();
          throw new Error(`HTTP 403: ${errorText}`);
        }
        
        if (response.status === 404) {
          throw new Error(`Kaynak bulunamadı: ${url}`);
        }
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        return await response.json();
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = backoff * Math.pow(2, attempt - 1);
        console.warn(`API hatası (deneme ${attempt}/${retries}), ${delay} ms sonra yeniden deneniyor:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async getWorkflowRuns(perPage = 10) {
    const url = `${this.githubBase}/repos/${this.owner}/${this.repo}/actions/runs?per_page=${perPage}&branch=main`;
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
    const data = await this.getFirebaseReleases(20);
    const releases = data.releases || [];
    return releases.find(r => r.type === 'RELEASE' && r.releaseTime) || null;
  }

  async triggerRollback(targetReleaseName) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    if (!this.token) {
      throw new Error('GITHUB_TOKEN yapılandırılmamış (Firebase Management API için OAuth gerekli)');
    }
    const url = `${this.firebaseBase}/projects/${this.projectId}/sites/${this.projectId}/releases/${targetReleaseName}:clone`;
    return this.fetchWithRetry(url, { method: 'POST', headers: { 'Authorization': `Bearer ${this.token}` } });
  }

  async tumVeriyiAl() {
    try {
      const [workflowRunsResponse, latestRunResponse, releasesResponse, lastSuccessResponse] = await Promise.allSettled([
        this.getWorkflowRuns(10),
        this.getLatestWorkflowRun(),
        this.getFirebaseReleases(10),
        this.getLastSuccessfulRelease()
      ]);

      const workflowRuns = workflowRunsResponse.status === 'fulfilled' ? (workflowRunsResponse.value.workflow_runs || []) : [];
      const latestRun = latestRunResponse.status === 'fulfilled' ? latestRunResponse.value : null;
      const releases = releasesResponse.status === 'fulfilled' ? (releasesResponse.value.releases || []) : [];
      const lastSuccessfulRelease = lastSuccessResponse.status === 'fulfilled' ? lastSuccessResponse.value : null;

      let workflowDurumu = 'Bilinmiyor';
      let workflowBaslangic = null;
      let workflowBitis = null;
      let workflowConclusion = null;

      if (latestRun) {
        workflowDurumu = latestRun.status || 'Bilinmiyor';
        workflowConclusion = latestRun.conclusion || 'Bilinmiyor';
        if (latestRun.run_started_at) workflowBaslangic = new Date(latestRun.run_started_at);
        if (latestRun.updated_at) workflowBitis = new Date(latestRun.updated_at);
      }

      return {
        workflowDurumu,
        workflowConclusion,
        workflowBaslangic,
        workflowBitis,
        latestRun,
        workflowRuns,
        releases,
        lastSuccessfulRelease,
        rollbackMevcut: !!lastSuccessfulRelease,
        // Dashboard uyumluluk alanları
        runs: workflowRuns,
        rollbackInfo: lastSuccessfulRelease ? { reason: 'Otomatik rollback hazır', timestamp: lastSuccessfulRelease.releaseTime ? new Date(lastSuccessfulRelease.releaseTime) : new Date() } : null
      };
    } catch (error) {
      console.error('API servisi verisi alınırken kritik hata:', error);
      return {
        workflowDurumu: 'Hata',
        workflowConclusion: 'Hata',
        workflowBaslangic: null,
        workflowBitis: null,
        latestRun: null,
        workflowRuns: [],
        releases: [],
        lastSuccessfulRelease: null,
        rollbackMevcut: false
      };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiServis;
} else if (typeof window !== 'undefined') {
  window.ApiServis = ApiServis;
}