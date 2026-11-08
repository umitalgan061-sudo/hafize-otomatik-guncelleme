class FirebaseServis {
  constructor(config) {
    this.config = config;
    this.projectId = config.FIREBASE_PROJECT_ID;
    this.apiKey = config.FIREBASE_API_KEY;
    this.baseUrl = 'https://firebasehosting.googleapis.com/v1beta1';
    this.headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      this.headers['Authorization'] = `Bearer ${this.apiKey}`;
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
            console.warn(`Firebase API rate limit aşıldı. ${Math.ceil(waitTime / 1000)} sn bekleniyor.`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
          console.warn(`Firebase API yetki hatası (403). API key geçerli olmayabilir veya proje erişimi yok: ${url}`);
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
        console.warn(`Firebase API hatası (deneme ${attempt}/${retries}), ${delay} ms sonra yeniden deneniyor:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async getSiteStatus() {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    const url = `${this.baseUrl}/projects/${this.projectId}/sites/${this.projectId}`;
    return this.fetchWithRetry(url);
  }

  async getReleases(pageSize = 20) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    const url = `${this.baseUrl}/projects/${this.projectId}/sites/${this.projectId}/releases?pageSize=${pageSize}`;
    return this.fetchWithRetry(url);
  }

  async getLastSuccessfulRelease() {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    const data = await this.getReleases(50);
    const releases = data.releases || [];
    return releases.find(r => r.type === 'RELEASE' && r.releaseTime) || null;
  }

  async triggerRollback(targetReleaseName) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    if (!this.apiKey) {
      throw new Error('FIREBASE_API_KEY yapılandırılmamış (Firebase Hosting REST API için gerekli)');
    }
    const url = `${this.baseUrl}/projects/${this.projectId}/sites/${this.projectId}/releases/${targetReleaseName}:clone`;
    return this.fetchWithRetry(url, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
  }

  async getReleaseHistory(limit = 10) {
    if (!this.projectId) {
      throw new Error('FIREBASE_PROJECT_ID yapılandırılmamış');
    }
    const data = await this.getReleases(limit);
    return data.releases || [];
  }

  async tumVeriyiAl() {
    try {
      const [siteResponse, releasesResponse] = await Promise.allSettled([
        this.getSiteStatus(),
        this.getReleases(20)
      ]);

      const site = siteResponse.status === 'fulfilled' ? siteResponse.value : null;
      const releases = releasesResponse.status === 'fulfilled' ? (releasesResponse.value.releases || []) : [];

      let siteDurumu = 'Bilinmiyor';
      let sonDeploy = null;

      if (site) {
        siteDurumu = site.type || 'ACTIVE';
      }

      if (releases.length > 0) {
        const latestRelease = releases[0];
        if (latestRelease.releaseTime) {
          sonDeploy = new Date(latestRelease.releaseTime);
        }
      }

      const lastSuccessfulRelease = releases.find(r => r.type === 'RELEASE' && r.releaseTime) || null;

      return {
        siteDurumu,
        sonDeploy,
        releases,
        site,
        lastSuccessfulRelease,
        rollbackMevcut: !!lastSuccessfulRelease
      };
    } catch (error) {
      console.error('Firebase verisi alınırken kritik hata:', error);
      return {
        siteDurumu: 'Hata',
        sonDeploy: null,
        releases: [],
        site: null,
        lastSuccessfulRelease: null,
        rollbackMevcut: false
      };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FirebaseServis;
} else if (typeof window !== 'undefined') {
  window.FirebaseServis = FirebaseServis;
}