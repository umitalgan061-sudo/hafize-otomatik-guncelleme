class IntegrationServis {
  constructor(config, services = {}) {
    this.config = config;
    this.services = {
      githubServis: services.githubServis,
      firebaseServis: services.firebaseServis,
      apiServis: services.apiServis,
      loggerServis: services.loggerServis,
      performanceServis: services.performanceServis,
      notifyServis: services.notifyServis
    };
    this.initialized = false;
    this.lastData = null;
    this.healthCache = {};
  }

  init() {
    if (this.initialized) return;
    
    // Logger servisini başlat
    if (this.services.loggerServis && typeof this.services.loggerServis.init === 'function') {
      this.services.loggerServis.init();
    }
    
    // Performance servisini başlat
    if (this.services.performanceServis && typeof this.services.performanceServis.init === 'function') {
      this.services.performanceServis.init();
    }
    
    // Notify servisini başlat
    if (this.services.notifyServis && typeof this.services.notifyServis.init === 'function') {
      this.services.notifyServis.init();
    }
    
    this.initialized = true;
    this.log('info', 'IntegrationServis başlatıldı');
  }

  log(level, message, context = null) {
    if (this.services.loggerServis) {
      this.services.loggerServis[level](message, { source: 'IntegrationServis', ...context });
    } else {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[IntegrationServis] ${message}`, context || '');
    }
  }

  async tumVeriyiAl() {
    this.log('info', 'Tüm veriler toplanıyor...');
    
    try {
      const [githubData, firebaseData, apiData] = await Promise.allSettled([
        this.services.githubServis?.tumVeriyiAl?.() ?? Promise.resolve({ commits: [], workflowRuns: [], workflow_runs: [], repo: {} }),
        this.services.firebaseServis?.tumVeriyiAl?.() ?? Promise.resolve({ siteDurumu: 'Bilinmiyor', sonDeploy: null, releases: [], lastSuccessfulRelease: null, rollbackMevcut: false }),
        this.services.apiServis?.tumVeriyiAl?.() ?? Promise.resolve({ workflowDurumu: 'Bilinmiyor', workflowConclusion: 'Bilinmiyor', latestRun: null, workflowRuns: [], releases: [], lastSuccessfulRelease: null, rollbackMevcut: false })
      ]);

      const github = githubData.status === 'fulfilled' ? githubData.value : { commits: [], workflowRuns: [], workflow_runs: [], repo: {} };
      const firebase = firebaseData.status === 'fulfilled' ? firebaseData.value : { siteDurumu: 'Bilinmiyor', sonDeploy: null, releases: [], lastSuccessfulRelease: null, rollbackMevcut: false };
      const api = apiData.status === 'fulfilled' ? apiData.value : { workflowDurumu: 'Bilinmiyor', workflowConclusion: 'Bilinmiyor', latestRun: null, workflowRuns: [], releases: [], lastSuccessfulRelease: null, rollbackMevcut: false };

      // Performans metriklerini al
      const performance = this.services.performanceServis?.getMetrics?.() ?? {};

      const combinedData = {
        github,
        firebase,
        workflow: api,
        performance,
        yuklenmeZamani: new Date(),
        timestamp: Date.now()
      };

      this.lastData = combinedData;
      
      // Dashboard data loaded event'ini tetikle
      this.dispatchEvent('dashboard-data-loaded', combinedData);
      
      this.log('info', 'Veri toplama tamamlandı', { 
        githubRuns: github.workflowRuns?.length || 0,
        firebaseReleases: firebase.releases?.length || 0,
        apiRuns: api.workflowRuns?.length || 0
      });

      return combinedData;
    } catch (error) {
      this.log('error', 'Veri toplama hatası', { error: error.message });
      throw error;
    }
  }

  async rollbackTest() {
    this.log('info', 'Rollback testi başlatılıyor...');
    
    try {
      const firebaseServis = this.services.firebaseServis;
      const apiServis = this.services.apiServis;
      
      // Önce Firebase servisinden son başarılı release'i al
      let lastSuccessfulRelease = null;
      
      if (firebaseServis && typeof firebaseServis.getLastSuccessfulRelease === 'function') {
        lastSuccessfulRelease = await firebaseServis.getLastSuccessfulRelease();
      } else if (apiServis && typeof apiServis.getLastSuccessfulRelease === 'function') {
        lastSuccessfulRelease = await apiServis.getLastSuccessfulRelease();
      }
      
      if (!lastSuccessfulRelease) {
        const error = 'Rollback için başarılı bir release bulunamadı';
        this.log('warning', error);
        
        const result = { success: false, error, releaseName: null, releaseTime: null };
        this.dispatchEvent('rollback-test-triggered', result);
        return result;
      }

      const releaseName = lastSuccessfulRelease.name || lastSuccessfulRelease.id;
      const releaseTime = lastSuccessfulRelease.releaseTime || lastSuccessfulRelease.createTime;
      
      this.log('info', 'Rollback hedef release bulundu', { releaseName, releaseTime });
      
      // Gerçek rollback tetikleme (test modunda sadece simüle et)
      // Not: Gerçek production'da firebaseServis.triggerRollback(releaseName) çağrılacak
      const isTestMode = true; // Test modu - gerçek rollback yapmaz
      
      if (isTestMode) {
        this.log('info', 'Test modu: Rollback simüle edildi (gerçek tetiklenmedi)', { releaseName });
        
        // Simüle edilmiş başarı sonucu
        const result = { 
          success: true, 
          releaseName, 
          releaseTime,
          simulated: true,
          message: 'Test modunda rollback simüle edildi. Gerçek ortamda Firebase Hosting release klonlanacaktı.'
        };
        
        this.dispatchEvent('rollback-test-triggered', result);
        
        if (this.services.notifyServis) {
          this.services.notifyServis.success('Rollback Testi', `Simüle edildi: ${releaseName}`);
        }
        
        return result;
      }
      
      // Gerçek rollback (production'da kullanılacak)
      if (firebaseServis && typeof firebaseServis.triggerRollback === 'function') {
        await firebaseServis.triggerRollback(releaseName);
        
        const result = { 
          success: true, 
          releaseName, 
          releaseTime,
          simulated: false
        };
        
        this.dispatchEvent('rollback-test-triggered', result);
        
        if (this.services.notifyServis) {
          this.services.notifyServis.success('Rollback', `Gerçek rollback tetiklendi: ${releaseName}`);
        }
        
        return result;
      }
      
      throw new Error('Firebase servisi rollback fonksiyonu bulunamadı');
    } catch (error) {
      this.log('error', 'Rollback testi hatası', { error: error.message });
      
      const result = { success: false, error: error.message, releaseName: null, releaseTime: null };
      this.dispatchEvent('rollback-test-triggered', result);
      
      if (this.services.notifyServis) {
        this.services.notifyServis.error('Rollback Testi Hatası', error.message);
      }
      
      return result;
    }
  }

  async forceRefresh() {
    this.log('info', 'Zorlu veri yenileme başlatılıyor...');
    
    try {
      // Cache'i temizle ve yeniden çek
      this.lastData = null;
      const data = await this.tumVeriyiAl();
      
      this.log('info', 'Zorlu yenileme tamamlandı');
      
      if (this.services.notifyServis) {
        this.services.notifyServis.success('Yenileme', 'Veriler zorla güncellendi');
      }
      
      return data;
    } catch (error) {
      this.log('error', 'Zorlu yenileme hatası', { error: error.message });
      
      if (this.services.notifyServis) {
        this.services.notifyServis.error('Yenileme Hatası', error.message);
      }
      
      throw error;
    }
  }

  getSystemHealth() {
    const health = {
      github: 'unknown',
      firebase: 'unknown',
      api: 'unknown',
      performance: 'unknown',
      logger: 'unknown',
      notify: 'unknown'
    };

    // GitHub servisi
    if (this.services.githubServis) {
      health.github = (this.config.GITHUB_TOKEN && this.config.REPO_OWNER && this.config.REPO_NAME) ? 'configured' : 'no-token';
    }

    // Firebase servisi
    if (this.services.firebaseServis) {
      health.firebase = (this.config.FIREBASE_PROJECT_ID && this.config.FIREBASE_API_KEY) ? 'configured' : 'no-project-id';
    }

    // API servisi
    if (this.services.apiServis) {
      health.api = (this.config.GITHUB_TOKEN && this.config.REPO_OWNER && this.config.REPO_NAME) ? 'configured' : 'missing';
    }

    // Performance servisi
    if (this.services.performanceServis) {
      health.performance = this.services.performanceServis.isInitialized ? 'active' : 'inactive';
    }

    // Logger servisi
    if (this.services.loggerServis) {
      health.logger = 'active';
    }

    // Notify servisi
    if (this.services.notifyServis) {
      health.notify = this.services.notifyServis.notificationPermission === 'granted' ? 'active' : 'inactive';
    }

    this.healthCache = health;
    return health;
  }

  dispatchEvent(eventName, detail) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch (e) {
      console.warn(`[IntegrationServis] Event dispatch hatası (${eventName}):`, e);
    }
  }

  // Performans metriklerini dashboard'a aktar
  reportPerformanceUpdate(metrics) {
    this.dispatchEvent('performance-update', metrics);
  }

  destroy() {
    this.initialized = false;
    this.lastData = null;
    this.healthCache = {};
    this.log('info', 'IntegrationServis yok edildi');
  }
}

// Global olarak kaydet
if (typeof window !== 'undefined') {
  window.IntegrationServis = IntegrationServis;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = IntegrationServis;
}