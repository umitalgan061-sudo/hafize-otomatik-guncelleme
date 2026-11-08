class GithubServis {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.githubApiBase || 'https://api.github.com';
    this.owner = config.REPO_OWNER;
    this.repo = config.REPO_NAME;
    this.headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (config.GITHUB_TOKEN) {
      this.headers['Authorization'] = `Bearer ${config.GITHUB_TOKEN}`;
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
            console.warn(`GitHub API rate limit aşıldı. ${Math.ceil(waitTime / 1000)} sn bekleniyor.`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
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
        console.warn(`GitHub API hatası (deneme ${attempt}/${retries}), ${delay} ms sonra yeniden deneniyor:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async getCommits(perPage = 10) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits?per_page=${perPage}`;
    return this.fetchWithRetry(url);
  }

  async getWorkflowRuns(perPage = 10) {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/actions/runs?per_page=${perPage}`;
    return this.fetchWithRetry(url);
  }

  async getRepoInfo() {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}`;
    return this.fetchWithRetry(url);
  }

  async tumVeriyiAl() {
    try {
      const [commitsResponse, workflowResponse, repoResponse] = await Promise.allSettled([
        this.getCommits(10),
        this.getWorkflowRuns(10),
        this.getRepoInfo()
      ]);

      const commits = commitsResponse.status === 'fulfilled' ? commitsResponse.value : [];
      const workflowRuns = workflowResponse.status === 'fulfilled' ? workflowResponse.value.workflow_runs : [];
      const repo = repoResponse.status === 'fulfilled' ? repoResponse.value : {};

      return { commits, workflowRuns, workflow_runs: workflowRuns, repo };
    } catch (error) {
      console.error('GitHub verisi alınırken kritik hata:', error);
      return { commits: [], workflowRuns: [], workflow_runs: [], repo: {} };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GithubServis;
} else if (typeof window !== 'undefined') {
  window.GithubServis = GithubServis;
}