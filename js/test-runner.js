class TestRunner {
  constructor(integrationServis) {
    this.integrationServis = integrationServis;
    this.results = [];
    this.notifyServis = window.notifyServis;
    this.loggerServis = window.loggerServis;
    this.performanceServis = window.performanceServis;
    
    // Global testRunner olarak kaydet
    if (typeof window !== 'undefined') {
      window.testRunner = this;
    }
  }

  async runTest(name, fn) {
    const startTime = Date.now();
    let result = { name, success: false, error: null, duration: 0, details: null };
    
    try {
      if (this.notifyServis) {
        this.notifyServis.info('Test Başlatıldı', name);
      }
      if (this.loggerServis) {
        this.loggerServis.info(`Test başlatıldı: ${name}`, { test: name });
      }
      
      const details = await fn();
      result.success = true;
      result.details = details;
      
      if (this.notifyServis) {
        this.notifyServis.success('Test Başarılı', `${name} - ${Math.round(Date.now() - startTime)}ms`);
      }
      if (this.loggerServis) {
        this.loggerServis.info(`Test başarılı: ${name}`, { test: name, duration: Date.now() - startTime, details });
      }
    } catch (error) {
      result.success = false;
      result.error = error.message;
      
      if (this.notifyServis) {
        this.notifyServis.error('Test Başarısız', `${name}: ${error.message}`, { duration: 8000 });
      }
      if (this.loggerServis) {
        this.loggerServis.error(`Test başarısız: ${name}`, { test: name, error: error.message, stack: error.stack });
      }
    } finally {
      result.duration = Date.now() - startTime;
      this.results.push(result);
    }
    
    return result;
  }

  async runAll() {
    this.results = [];
    
    if (this.notifyServis) {
      this.notifyServis.info('E2E Testler', 'Tüm test senaryoları başlatılıyor...');
    }
    if (this.loggerServis) {
      this.loggerServis.info('E2E test paketi başlatıldı');
    }
    
    const tests = [
      { name: 'Bildirim Sistemi', fn: () => this.testNotify() },
      { name: 'Logger Servisi', fn: () => this.testLogger() },
      { name: 'Performans Servisi', fn: () => this.testPerformance() },
      { name: 'Rollback Mekanizması', fn: () => this.testRollback() },
      { name: 'API Entegrasyonu', fn: () => this.testApi() },
      { name: 'Integration Servisi', fn: () => this.testIntegration() },
      { name: 'Sistem Sağlığı', fn: () => this.testHealth() }
    ];
    
    for (const test of tests) {
      await this.runTest(test.name, test.fn);
      // Testler arası kısa bekleme
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Özet bildirimi
    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;
    
    if (this.notifyServis) {
      if (failed === 0) {
        this.notifyServis.success('E2E Testler Tamamlandı', `${passed}/${tests.length} test başarılı`, { duration: 5000 });
      } else {
        this.notifyServis.warning('E2E Testler Tamamlandı', `${passed}/${tests.length} başarılı, ${failed} başarısız`, { duration: 8000 });
      }
    }
    
    if (this.loggerServis) {
      this.loggerServis.info('E2E test paketi tamamlandı', { passed, failed, total: tests.length, results: this.results });
    }
    
    return this.results;
  }

  // Test Senaryoları
  
  async testNotify() {
    if (!this.notifyServis) throw new Error('NotifyServis bulunamadı');
    
    // Farklı bildirim türlerini test et
    this.notifyServis.success('Test Bildirimi', 'Success toast çalışıyor');
    await new Promise(r => setTimeout(r, 100));
    this.notifyServis.error('Test Bildirimi', 'Error toast çalışıyor');
    await new Promise(r => setTimeout(r, 100));
    this.notifyServis.warning('Test Bildirimi', 'Warning toast çalışıyor');
    await new Promise(r => setTimeout(r, 100));
    this.notifyServis.info('Test Bildirimi', 'Info toast çalışıyor');
    await new Promise(r => setTimeout(r, 100));
    
    // Geçmiş kontrolü
    const history = this.notifyServis.getHistory();
    if (history.length === 0) throw new Error('Bildirim geçmişi boş');
    
    // Ses testi (sessiz modda)
    const prevSound = this.notifyServis.soundEnabled;
    this.notifyServis.setSoundEnabled(false);
    this.notifyServis.success('Ses Testi', 'Ses kapalı modda');
    this.notifyServis.setSoundEnabled(prevSound);
    
    return { historyCount: history.length, soundTested: true };
  }

  async testLogger() {
    if (!this.loggerServis) throw new Error('LoggerServis bulunamadı');
    
    // Farklı log seviyelerini test et
    this.loggerServis.error('Test hatası', { test: true, code: 'TEST_ERROR' });
    this.loggerServis.warn('Test uyarısı', { test: true });
    this.loggerServis.info('Test bilgisi', { test: true });
    this.loggerServis.debug('Test debug', { test: true });
    
    // Log alma ve filtreleme
    const allLogs = this.loggerServis.getLogs('all');
    const errorLogs = this.loggerServis.getLogs('error');
    const warnLogs = this.loggerServis.getLogs('warn');
    const infoLogs = this.loggerServis.getLogs('info');
    
    if (allLogs.length === 0) throw new Error('Log listesi boş');
    if (errorLogs.length === 0) throw new Error('Hata logu bulunamadı');
    
    // Detay modal testi (panel oluşturulmuş olmalı)
    if (!this.loggerServis.panel) {
      this.loggerServis.createPanel();
    }
    
    return { 
      totalLogs: allLogs.length, 
      errorCount: errorLogs.length, 
      warnCount: warnLogs.length, 
      infoCount: infoLogs.length,
      panelCreated: !!this.loggerServis.panel
    };
  }

  async testPerformance() {
    if (!this.performanceServis) throw new Error('PerformanceServis bulunamadı');
    
    // Servis başlatılmış mı kontrol et
    if (!this.performanceServis.isInitialized) {
      this.performanceServis.init();
      // Observer'ların başlaması için kısa bekle
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Metrikleri al
    const metrics = this.performanceServis.getMetrics();
    
    // En az bir metrik ölçülmüş olmalı (sayfa yüklendiyse)
    const hasMetrics = metrics.lcp || metrics.fid || metrics.cls || metrics.fcp || metrics.ttfb;
    
    // Dashboard raporlama testi
    this.performanceServis.reportToDashboard();
    await new Promise(r => setTimeout(r, 50));
    
    return { 
      metrics: Object.keys(metrics).filter(k => metrics[k]).length,
      lcp: metrics.lcp ? { value: metrics.lcp.value, rating: metrics.lcp.rating } : null,
      fid: metrics.fid ? { value: metrics.fid.value, rating: metrics.fid.rating } : null,
      cls: metrics.cls ? { value: metrics.cls.value, rating: metrics.cls.rating } : null,
      fcp: metrics.fcp ? { value: metrics.fcp.value, rating: metrics.fcp.rating } : null,
      ttfb: metrics.ttfb ? { value: metrics.ttfb.value, rating: metrics.ttfb.rating } : null,
      hasAnyMetric: !!hasMetrics
    };
  }

  async testRollback() {
    if (!this.integrationServis) throw new Error('IntegrationServis bulunamadı');
    
    // Integration servisi üzerinden rollback testi
    const result = await this.integrationServis.rollbackTest();
    
    if (!result || typeof result.success === 'undefined') {
      throw new Error('Rollback testi geçersiz sonuç döndürdü');
    }
    
    return {
      success: result.success,
      releaseName: result.releaseName,
      releaseTime: result.releaseTime,
      error: result.error
    };
  }

  async testApi() {
    if (!this.integrationServis || !this.integrationServis.apiServis) {
      throw new Error('ApiServis bulunamadı');
    }
    
    const apiServis = this.integrationServis.apiServis;
    
    // Temel API çağrılarını test et
    const data = await apiServis.tumVeriyiAl();
    
    if (!data) throw new Error('API veri döndürmedi');
    if (typeof data.workflowDurumu === 'undefined') throw new Error('Workflow durumu eksik');
    if (!Array.isArray(data.workflowRuns)) throw new Error('Workflow runs dizi değil');
    if (!Array.isArray(data.releases)) throw new Error('Releases dizi değil');
    
    return {
      workflowDurumu: data.workflowDurumu,
      workflowRunsCount: data.workflowRuns.length,
      releasesCount: data.releases.length,
      rollbackMevcut: data.rollbackMevcut,
      hasLatestRun: !!data.latestRun
    };
  }

  async testIntegration() {
    if (!this.integrationServis) throw new Error('IntegrationServis bulunamadı');
    
    // tumVeriyiAl testi
    const data = await this.integrationServis.tumVeriyiAl();
    
    if (!data) throw new Error('Integration veri döndürmedi');
    if (typeof data.github === 'undefined') throw new Error('GitHub verisi eksik');
    if (typeof data.firebase === 'undefined') throw new Error('Firebase verisi eksik');
    if (typeof data.workflow === 'undefined') throw new Error('Workflow verisi eksik');
    if (typeof data.yuklenmeZamani === 'undefined') throw new Error('Yükleme zamanı eksik');
    
    // forceRefresh testi
    await this.integrationServis.forceRefresh();
    
    // getSystemHealth testi
    const health = this.integrationServis.getSystemHealth();
    if (!health || typeof health !== 'object') throw new Error('Sistem sağlığı döndürülmedi');
    
    return {
      hasGithub: !!data.github,
      hasFirebase: !!data.firebase,
      hasWorkflow: !!data.workflow,
      hasTimestamp: !!data.yuklenmeZamani,
      healthKeys: Object.keys(health),
      forceRefreshWorks: true
    };
  }

  async testHealth() {
    if (!this.integrationServis) throw new Error('IntegrationServis bulunamadı');
    
    const health = this.integrationServis.getSystemHealth();
    
    const expectedServices = ['github', 'firebase', 'api', 'logger', 'performance', 'notify'];
    const missingServices = expectedServices.filter(s => !(s in health));
    
    if (missingServices.length > 0) {
      throw new Error(`Eksik servisler: ${missingServices.join(', ')}`);
    }
    
    // Her servis için durum kontrolü
    const statuses = {};
    for (const service of expectedServices) {
      statuses[service] = health[service];
    }
    
    return {
      allServicesPresent: missingServices.length === 0,
      statuses,
      configuredCount: Object.values(health).filter(s => s === 'configured' || s === 'active').length
    };
  }

  getResults() {
    return [...this.results];
  }

  getSummary() {
    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    return {
      passed,
      failed,
      total: this.results.length,
      totalDuration,
      results: this.results
    };
  }

  clearResults() {
    this.results = [];
  }

  destroy() {
    this.results = [];
    this.integrationServis = null;
    this.notifyServis = null;
    this.loggerServis = null;
    this.performanceServis = null;
    
    if (typeof window !== 'undefined' && window.testRunner === this) {
      window.testRunner = null;
    }
  }
}

// Global TestRunner sınıfını window'a ekle
if (typeof window !== 'undefined') {
  window.TestRunner = TestRunner;
}

// Modül export (Node.js ortamı için)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TestRunner;
}