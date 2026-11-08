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
    this.chartsInitialized = false;
    this.chartInstances = {
      workflowTrend: null,
      deployTimes: null,
      rollbackTrend: null,
      testSuccessRate: null
    };
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
      
      // Dashboard metriklerini hesapla ve event tetikle
      const dashboardMetrics = this.calculateDashboardMetrics(combinedData);
      this.dispatchEvent('dashboard-data-loaded', { ...combinedData, dashboardMetrics });
      
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

  /**
   * Dashboard grafikleri için metrikleri hesaplar
   * @param {Object} combinedData - tumVeriyiAl'dan dönen birleşik veri
   * @returns {Object} Grafik verileri ve özet metrikler
   */
  calculateDashboardMetrics(combinedData) {
    const { github, firebase, workflow, performance } = combinedData;
    
    // Workflow run verilerini birleştir (api servisinden gelen runs öncelikli)
    const runs = workflow.workflowRuns?.length > 0 
      ? workflow.workflowRuns 
      : github.workflowRuns || github.workflow_runs || [];
    
    // Son 20 çalışma (eski -> yeni sırası için reverse)
    const recentRuns = [...runs].reverse().slice(0, 20);
    
    // 1. Workflow Başarı Trendi (son 20 çalışma)
    const workflowTrend = {
      labels: recentRuns.map(run => {
        const date = run.run_started_at ? new Date(run.run_started_at) : new Date();
        return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      }),
      data: recentRuns.map(run => {
        if (run.conclusion === 'success') return 1;
        if (run.conclusion === 'failure') return 0;
        return null; // in_progress, queued, waiting, cancelled vb.
      }),
      summary: {
        total: recentRuns.length,
        success: recentRuns.filter(r => r.conclusion === 'success').length,
        failure: recentRuns.filter(r => r.conclusion === 'failure').length,
        inProgress: recentRuns.filter(r => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting').length,
        successRate: recentRuns.length > 0 
          ? Math.round((recentRuns.filter(r => r.conclusion === 'success').length / recentRuns.filter(r => r.status === 'completed').length) * 100) || 0
          : 0
      }
    };
    
    // 2. Deploy Süreleri (son 20 çalışma, sadece başarılı olanlar)
    const deployTimes = {
      labels: recentRuns.map(run => {
        const date = run.run_started_at ? new Date(run.run_started_at) : new Date();
        return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      }),
      data: recentRuns.map(run => {
        if (run.status !== 'completed' || run.conclusion !== 'success' || !run.run_started_at || !run.updated_at) {
          return null;
        }
        const ms = new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime();
        return Math.round(ms / 60000); // dakika cinsinden
      }),
      summary: {
        average: null,
        min: null,
        max: null,
        last: null,
        trend: 'stable' // 'improving', 'degrading', 'stable'
      }
    };
    
    // Deploy süreleri özeti hesapla
    const validDeployTimes = deployTimes.data.filter(v => v !== null);
    if (validDeployTimes.length > 0) {
      deployTimes.summary.average = Math.round(validDeployTimes.reduce((a, b) => a + b, 0) / validDeployTimes.length);
      deployTimes.summary.min = Math.min(...validDeployTimes);
      deployTimes.summary.max = Math.max(...validDeployTimes);
      deployTimes.summary.last = validDeployTimes[validDeployTimes.length - 1];
      
      // Trend hesapla (son 3 ile önceki 3'ün ortalamasını karşılaştır)
      if (validDeployTimes.length >= 6) {
        const last3 = validDeployTimes.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const prev3 = validDeployTimes.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
        if (last3 < prev3 * 0.9) deployTimes.summary.trend = 'improving';
        else if (last3 > prev3 * 1.1) deployTimes.summary.trend = 'degrading';
      }
    }
    
    // 3. Rollback Sayısı ve Başarısı
    const releases = firebase.releases || [];
    const rollbackReleases = releases.filter(r => r.type === 'ROLLBACK' || (r.version && r.version.includes('rollback')));
    const successfulReleases = releases.filter(r => r.type === 'RELEASE' && r.releaseTime);
    
    const rollbackMetrics = {
      totalRollbacks: rollbackReleases.length,
      successfulRollbacks: rollbackReleases.filter(r => r.releaseTime).length,
      failedRollbacks: rollbackReleases.filter(r => !r.releaseTime).length,
      rollbackRate: releases.length > 0 ? Math.round((rollbackReleases.length / releases.length) * 100) : 0,
      lastRollback: rollbackReleases.length > 0 ? rollbackReleases[0] : null,
      rollbackHistory: rollbackReleases.slice(0, 10).map(r => ({
        name: r.name,
        time: r.releaseTime || r.createTime,
        version: r.version
      })),
      trend: {
        labels: [...releases].reverse().slice(0, 20).map(r => {
          const date = r.releaseTime ? new Date(r.releaseTime) : new Date(r.createTime);
          return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
        }),
        data: [...releases].reverse().slice(0, 20).map(r => r.type === 'ROLLBACK' ? 1 : 0)
      }
    };
    
    // 4. Test Başarı Oranı (TestRunner sonuçları - simüle edilmiş veya gerçek)
    // Gerçek test sonuçları varsa onları kullan, yoksa workflow job'larından çıkarım yap
    const jobs = workflow.jobs || {};
    const testMetrics = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      successRate: 0,
      lastRun: null,
      trend: {
        labels: [],
        data: []
      }
    };
    
    if (jobs && jobs.jobs && jobs.jobs.length > 0) {
      // Job'lardan test adımlarını çıkarım yap
      const testJobs = jobs.jobs.filter(j => 
        j.name.toLowerCase().includes('test') || 
        j.name.toLowerCase().includes('e2e') ||
        j.name.toLowerCase().includes('spec')
      );
      
      testMetrics.totalTests = testJobs.length;
      testMetrics.passedTests = testJobs.filter(j => j.conclusion === 'success').length;
      testMetrics.failedTests = testJobs.filter(j => j.conclusion === 'failure').length;
      testMetrics.skippedTests = testJobs.filter(j => j.conclusion === 'skipped').length;
      testMetrics.successRate = testMetrics.totalTests > 0 
        ? Math.round((testMetrics.passedTests / testMetrics.totalTests) * 100)
        : 0;
      testMetrics.lastRun = testJobs.length > 0 ? testJobs[0] : null;
    }
    
    // Eğer TestRunner'dan gerçek veri gelirse (global window.testRunner.results)
    if (typeof window !== 'undefined' && window.testRunner && window.testRunner.results && window.testRunner.results.length > 0) {
      const trResults = window.testRunner.results;
      testMetrics.totalTests = trResults.length;
      testMetrics.passedTests = trResults.filter(r => r.success).length;
      testMetrics.failedTests = trResults.filter(r => !r.success).length;
      testMetrics.successRate = Math.round((testMetrics.passedTests / testMetrics.totalTests) * 100);
      testMetrics.lastRun = trResults[trResults.length - 1];
    }
    
    // Test trendi için son workflow run'lerden test job'larını topla
    const testTrendRuns = runs.slice(0, 10);
    testMetrics.trend = {
      labels: testTrendRuns.map(run => {
        const date = run.run_started_at ? new Date(run.run_started_at) : new Date();
        return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
      }),
      data: testTrendRuns.map(run => {
        // Her run için test başarısı varsayımı (gerçekte job detaylarından gelmeli)
        if (run.conclusion === 'success') return 100;
        if (run.conclusion === 'failure') return 0;
        return null;
      })
    };
    
    return {
      workflowTrend,
      deployTimes,
      rollbackMetrics,
      testMetrics,
      timestamp: Date.now()
    };
  }

  /**
   * Chart.js grafiklerini başlatır veya günceller
   * @param {Object} dashboardMetrics - calculateDashboardMetrics çıktısı
   */
  updateCharts(dashboardMetrics) {
    if (typeof Chart === 'undefined') {
      this.log('warn', 'Chart.js yüklenmemiş, grafikler güncellenemedi');
      return;
    }
    
    if (!dashboardMetrics || typeof dashboardMetrics !== 'object') {
      this.log('warn', 'Geçersiz dashboardMetrics verisi');
      return;
    }
    
    // Mevcut chart canvas'ları
    const ctxTrend = document.getElementById('chart-workflow-trend');
    const ctxDeploy = document.getElementById('chart-deploy-times');
    
    if (!ctxTrend || !ctxDeploy) {
      this.log('warn', 'Chart canvas elementleri bulunamadı');
      return;
    }
    
    // Safe getters for nested properties with defaults
    const workflowTrend = dashboardMetrics.workflowTrend || { labels: [], data: [], summary: {} };
    const deployTimes = dashboardMetrics.deployTimes || { labels: [], data: [], summary: {} };
    const rollbackMetrics = dashboardMetrics.rollbackMetrics || { trend: { labels: [], data: [] } };
    const testMetrics = dashboardMetrics.testMetrics || { trend: { labels: [], data: [] } };
    
    // 1. Workflow Başarı Trendi Grafiği
    if (this.chartInstances.workflowTrend) {
      try { this.chartInstances.workflowTrend.destroy(); } catch (e) {}
      this.chartInstances.workflowTrend = null;
    }
    
    this.chartInstances.workflowTrend = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: Array.isArray(workflowTrend.labels) ? workflowTrend.labels : [],
        datasets: [{
          label: 'Başarı (1) / Başarısızlık (0)',
          data: Array.isArray(workflowTrend.data) ? workflowTrend.data : [],
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: (Array.isArray(workflowTrend.data) ? workflowTrend.data : []).map(v => 
            v === 1 ? '#28a745' : v === 0 ? '#dc3545' : '#6c757d'
          ),
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.raw;
                if (val === 1) return '✓ Başarılı';
                if (val === 0) return '✗ Başarısız';
                return '⏳ Devam ediyor / Bilinmiyor';
              }
            }
          }
        },
        scales: {
          y: {
            min: -0.1,
            max: 1.1,
            ticks: {
              stepSize: 1,
              callback: (value) => value === 1 ? 'Başarılı' : value === 0 ? 'Başarısız' : ''
            },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          x: {
            ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } },
            grid: { display: false }
          }
        },
        interaction: { intersect: false, mode: 'index' }
      }
    });
    
    // 2. Deploy Süreleri Grafiği
    if (this.chartInstances.deployTimes) {
      try { this.chartInstances.deployTimes.destroy(); } catch (e) {}
      this.chartInstances.deployTimes = null;
    }
    
    this.chartInstances.deployTimes = new Chart(ctxDeploy, {
      type: 'bar',
      data: {
        labels: Array.isArray(deployTimes.labels) ? deployTimes.labels : [],
        datasets: [{
          label: 'Deploy Süresi (dk)',
          data: Array.isArray(deployTimes.data) ? deployTimes.data : [],
          backgroundColor: (Array.isArray(deployTimes.data) ? deployTimes.data : []).map(v => 
            v === null || v === undefined ? 'rgba(108, 117, 125, 0.3)' : 
            v <= 5 ? 'rgba(40, 167, 69, 0.7)' : 
            v <= 10 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(220, 53, 69, 0.7)'
          ),
          borderColor: (Array.isArray(deployTimes.data) ? deployTimes.data : []).map(v => 
            v === null || v === undefined ? '#6c757d' : 
            v <= 5 ? '#28a745' : 
            v <= 10 ? '#ffc107' : '#dc3545'
          ),
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.raw;
                return val === null || val === undefined ? 'Veri yok' : `${val} dakika`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Dakika', font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 10 } }
          },
          x: {
            ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } },
            grid: { display: false }
          }
        },
        interaction: { intersect: false, mode: 'index' }
      }
    });
    
    // 3. Rollback Trendi Grafiği (eğer canvas varsa)
    const ctxRollback = document.getElementById('chart-rollback-trend');
    if (ctxRollback) {
      if (this.chartInstances.rollbackTrend) {
        try { this.chartInstances.rollbackTrend.destroy(); } catch (e) {}
        this.chartInstances.rollbackTrend = null;
      }
      
      const rbLabels = Array.isArray(rollbackMetrics.trend?.labels) ? rollbackMetrics.trend.labels : [];
      const rbData = Array.isArray(rollbackMetrics.trend?.data) ? rollbackMetrics.trend.data : [];
      
      this.chartInstances.rollbackTrend = new Chart(ctxRollback, {
        type: 'bar',
        data: {
          labels: rbLabels,
          datasets: [{
            label: 'Rollback (1) / Normal Deploy (0)',
            data: rbData,
            backgroundColor: rbData.map(v => 
              v === 1 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(40, 167, 69, 0.7)'
            ),
            borderColor: rbData.map(v => 
              v === 1 ? '#ffc107' : '#28a745'
            ),
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => context.raw === 1 ? '⚠ Rollback' : '✓ Normal Deploy'
              }
            }
          },
          scales: {
            y: {
              min: -0.1,
              max: 1.1,
              ticks: { stepSize: 1, callback: v => v === 1 ? 'Rollback' : v === 0 ? 'Deploy' : '' },
              grid: { color: 'rgba(0,0,0,0.05)' }
            },
            x: {
              ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } },
              grid: { display: false }
            }
          }
        }
      });
    }
    
    // 4. Test Başarı Oranı Grafiği (eğer canvas varsa)
    const ctxTest = document.getElementById('chart-test-success');
    if (ctxTest) {
      if (this.chartInstances.testSuccessRate) {
        try { this.chartInstances.testSuccessRate.destroy(); } catch (e) {}
        this.chartInstances.testSuccessRate = null;
      }
      
      const testLabels = Array.isArray(testMetrics.trend?.labels) ? testMetrics.trend.labels : [];
      const testData = Array.isArray(testMetrics.trend?.data) ? testMetrics.trend.data : [];
      
      this.chartInstances.testSuccessRate = new Chart(ctxTest, {
        type: 'line',
        data: {
          labels: testLabels,
          datasets: [{
            label: 'Test Başarı Oranı (%)',
            data: testData,
            borderColor: '#17a2b8',
            backgroundColor: 'rgba(23, 162, 184, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: testData.map(v => 
              v === null || v === undefined ? '#6c757d' : v >= 80 ? '#28a745' : v >= 50 ? '#ffc107' : '#dc3545'
            ),
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            spanGaps: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const val = context.raw;
                  return val === null || val === undefined ? 'Veri yok' : `%${val} başarı`;
                }
              }
            }
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              title: { display: true, text: 'Başarı Oranı (%)', font: { size: 11 } },
              grid: { color: 'rgba(0,0,0,0.05)' },
              ticks: { font: { size: 10 }, callback: v => `${v}%` }
            },
            x: {
              ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } },
              grid: { display: false }
            }
          },
          interaction: { intersect: false, mode: 'index' }
        }
      });
    }
    
    // Metrik kartlarını güncelle
    this.updateMetricCards(dashboardMetrics);
  }

  /**
   * Dashboard metrik kartlarını günceller
   * @param {Object} dashboardMetrics - calculateDashboardMetrics çıktısı
   */
  updateMetricCards(dashboardMetrics) {
    if (!dashboardMetrics || typeof dashboardMetrics !== 'object') {
      return;
    }
    
    const workflowTrend = dashboardMetrics.workflowTrend || { summary: {} };
    const deployTimes = dashboardMetrics.deployTimes || { summary: {} };
    const rollbackMetrics = dashboardMetrics.rollbackMetrics || { totalRollbacks: 0 };
    const testMetrics = dashboardMetrics.testMetrics || { successRate: 0 };
    
    // Ortalama Deploy Süresi
    const ortDeployEl = document.getElementById('ort-deploy-suresi');
    if (ortDeployEl && deployTimes.summary?.average !== null && deployTimes.summary?.average !== undefined) {
      ortDeployEl.textContent = `${deployTimes.summary.average} dk`;
    }
    
    // Başarı Oranı
    const basariOraniEl = document.getElementById('basari-orani');
    if (basariOraniEl) {
      const rate = workflowTrend.summary?.successRate ?? 0;
      basariOraniEl.textContent = `%${rate}`;
      basariOraniEl.className = 'stat-value ' + (
        rate >= 80 ? 'badge-success' :
        rate >= 50 ? 'badge-warning' : 'badge-danger'
      );
    }
    
    // Son 24 saat deploy sayısı
    const son24DeployEl = document.getElementById('son24-deploy');
    if (son24DeployEl) {
      son24DeployEl.textContent = (workflowTrend.summary?.total ?? 0).toString();
    }
    
    // Rollback sayısı kartı (eğer varsa)
    const rollbackCountEl = document.getElementById('rollback-sayisi');
    if (rollbackCountEl) {
      const count = rollbackMetrics.totalRollbacks ?? 0;
      rollbackCountEl.textContent = count.toString();
      rollbackCountEl.className = 'stat-value ' + (
        count === 0 ? 'badge-success' :
        count <= 2 ? 'badge-warning' : 'badge-danger'
      );
    }
    
    // Test başarı oranı kartı (eğer varsa)
    const testSuccessEl = document.getElementById('test-basari-orani');
    if (testSuccessEl) {
      const rate = testMetrics.successRate ?? 0;
      testSuccessEl.textContent = `%${rate}`;
      testSuccessEl.className = 'stat-value ' + (
        rate >= 80 ? 'badge-success' :
        rate >= 50 ? 'badge-warning' : 'badge-danger'
      );
    }
    
    // Performans metrik kartları
    this.updatePerformanceMetricCards();
  }

  /**
   * Performans metrik kartlarını günceller (PerformanceServis'ten gelen verilerle)
   */
  updatePerformanceMetricCards() {
    if (!this.services.performanceServis) return;
    
    const metrics = this.services.performanceServis.getMetrics();
    if (!metrics || typeof metrics !== 'object') return;
    
    const perfElements = {
      lcp: { val: document.getElementById('perf-lcp'), panelVal: document.getElementById('perf-lcp-val') },
      fid: { val: document.getElementById('perf-fid'), panelVal: document.getElementById('perf-fid-val') },
      cls: { val: document.getElementById('perf-cls'), panelVal: document.getElementById('perf-cls-val') },
      fcp: { val: document.getElementById('perf-fcp'), panelVal: document.getElementById('perf-fcp-val') },
      ttfb: { val: document.getElementById('perf-ttfb'), panelVal: document.getElementById('perf-ttfb-val') }
    };
    
    let hasAnyMetric = false;
    
    Object.entries(perfElements).forEach(([key, els]) => {
      const metric = metrics[key];
      if (metric && typeof metric === 'object' && metric.value !== undefined && metric.value !== null) {
        hasAnyMetric = true;
        const unit = key === 'cls' ? '' : 'ms';
        const displayValue = `${metric.value}${unit}`;
        const rating = metric.rating || 'unknown';
        
        if (els.val) {
          els.val.textContent = displayValue;
          els.val.className = 'stat-value ' + (
            rating === 'good' ? 'badge-success' :
            rating === 'needs-improvement' ? 'badge-warning' : 'badge-danger'
          );
        }
        if (els.panelVal) {
          els.panelVal.textContent = displayValue;
          els.panelVal.parentElement.className = 'perf-metric ' + (
            rating === 'good' ? 'perf-good' :
            rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor'
          );
        }
      }
    });
    
    const statsPerformansEl = document.getElementById('stats-performans');
    if (statsPerformansEl && hasAnyMetric) {
      statsPerformansEl.style.display = 'grid';
    }
  }

  async rollbackTest() {
    this.log('info', 'Rollback testi başlatılıyor...');
    
    try {
      const firebaseServis = this.services.firebaseServis;
      const apiServis = this.services.apiServis;
      const notifyServis = this.services.notifyServis;
      const loggerServis = this.services.loggerServis;
      
      // Test modu kontrolü (localStorage'dan veya window'dan)
      const isTestMode = this.getTestMode();
      
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
        
        const result = { success: false, error, releaseName: null, releaseTime: null, simulated: isTestMode };
        this.dispatchEvent('rollback-test-triggered', result);
        this.saveRollbackHistory(result);
        return result;
      }

      const releaseName = lastSuccessfulRelease.name || lastSuccessfulRelease.id;
      const releaseTime = lastSuccessfulRelease.releaseTime || lastSuccessfulRelease.createTime;
      
      this.log('info', 'Rollback hedef release bulundu', { releaseName, releaseTime, testMode: isTestMode });
      
      let result;
      
      if (isTestMode) {
        // Test modu: Simülasyon
        this.log('info', 'Test modu: Rollback simüle edildi', { releaseName });
        
        result = { 
          success: true, 
          releaseName, 
          releaseTime,
          simulated: true,
          message: 'Test modunda rollback simüle edildi. Gerçek ortamda Firebase Hosting release klonlanacaktı.'
        };
        
        if (notifyServis) {
          notifyServis.success('Rollback Testi (Simülasyon)', `Test modu: ${releaseName}`);
        }
      } else {
        // Production modu: Gerçek Firebase Hosting clone API çağrısı
        this.log('info', 'Production modu: Gerçek rollback tetikleniyor', { releaseName });
        
        try {
          if (firebaseServis && typeof firebaseServis.triggerRollback === 'function') {
            await firebaseServis.triggerRollback(releaseName);
            
            // Rollback sonrası deploy doğrulaması (site erişilebilir mi?)
            const verificationResult = await this.verifyRollbackDeployment();
            
            result = { 
              success: verificationResult.success, 
              releaseName, 
              releaseTime,
              simulated: false,
              verified: verificationResult.success,
              verificationDetails: verificationResult
            };
            
            if (verificationResult.success) {
              this.log('info', 'Rollback başarılı ve doğrulandı', { releaseName });
              if (notifyServis) {
                notifyServis.success('Rollback Başarılı', `Gerçek rollback tamamlandı ve doğrulandı: ${releaseName}`);
              }
            } else {
              this.log('error', 'Rollback tetiklendi ancak doğrulama başarısız', { releaseName, details: verificationResult });
              if (notifyServis) {
                notifyServis.error('Rollback Doğrulama Başarısız', `Rollback tetiklendi ancak site erişilemiyor: ${releaseName}`);
              }
            }
          } else {
            throw new Error('Firebase servisi rollback fonksiyonu bulunamadı');
          }
        } catch (rollbackError) {
          this.log('error', 'Rollback API hatası', { error: rollbackError.message, releaseName });
          
          result = { 
            success: false, 
            error: rollbackError.message, 
            releaseName, 
            releaseTime,
            simulated: false
          };
          
          if (notifyServis) {
            notifyServis.error('Rollback Hatası', rollbackError.message);
          }
        }
      }
      
      // Rollback geçmişini localStorage'a kaydet
      this.saveRollbackHistory(result);
      
      // Logger servisi ile logla
      if (loggerServis) {
        if (result.success) {
          loggerServis.info('Rollback testi tamamlandı', { 
            releaseName: result.releaseName, 
            simulated: result.simulated,
            verified: result.verified 
          });
        } else {
          loggerServis.error('Rollback testi başarısız', { 
            error: result.error, 
            releaseName: result.releaseName,
            simulated: result.simulated 
          });
        }
      }
      
      this.dispatchEvent('rollback-test-triggered', result);
      
      return result;
    } catch (error) {
      this.log('error', 'Rollback testi kritik hatası', { error: error.message });
      
      const result = { success: false, error: error.message, releaseName: null, releaseTime: null, simulated: this.getTestMode() };
      this.dispatchEvent('rollback-test-triggered', result);
      this.saveRollbackHistory(result);
      
      if (this.services.notifyServis) {
        this.services.notifyServis.error('Rollback Testi Hatası', error.message);
      }
      
      return result;
    }
  }

  /**
   * Test modu durumunu alır (Ctrl+Shift+T ile toggle edilir)
   * @returns {boolean} true = test modu, false = production modu
   */
  getTestMode() {
    try {
      const stored = localStorage.getItem('hafize_test_mode');
      if (stored !== null) {
        return JSON.parse(stored);
      }
    } catch (e) {
      // localStorage erişilemezse varsayılan test modu
    }
    return true; // Varsayılan: test modu (güvenli)
  }

  /**
   * Test modunu ayarlar
   * @param {boolean} enabled 
   */
  setTestMode(enabled) {
    try {
      localStorage.setItem('hafize_test_mode', JSON.stringify(!!enabled));
      this.log('info', `Test modu ${enabled ? 'aktif' : 'pasif'}`, { testMode: enabled });
      
      if (this.services.notifyServis) {
        this.services.notifyServis.info('Test Modu', enabled ? 'Test modu aktif (simülasyon)' : 'Production modu aktif (gerçek API çağrıları)');
      }
    } catch (e) {
      this.log('warn', 'Test modu kaydedilemedi', { error: e.message });
    }
  }

  /**
   * Test modunu toggle eder
   */
  toggleTestMode() {
    const newMode = !this.getTestMode();
    this.setTestMode(newMode);
    return newMode;
  }

  /**
   * Rollback sonrası deploy doğrulaması - site erişilebilir mi?
   * @returns {Promise<Object>} Doğrulama sonucu
   */
  async verifyRollbackDeployment() {
    const projectId = this.config.FIREBASE_PROJECT_ID;
    if (!projectId) {
      return { success: false, error: 'FIREBASE_PROJECT_ID yapılandırılmamış', checked: false };
    }
    
    const siteUrl = `https://${projectId}.web.app/`;
    
    try {
      this.log('info', 'Rollback doğrulaması başlatılıyor', { siteUrl });
      
      // Kısa bir bekleme (Firebase deploy yayılması için)
      await new Promise(r => setTimeout(r, 5000));
      
      // Siteye HEAD isteği at (daha hızlı)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      try {
        const response = await fetch(siteUrl, { 
          method: 'HEAD', 
          mode: 'no-cors', // CORS engellemesinden kaçınmak için
          signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        
        // no-cors modunda response.ok her zaman true döner, 
        // ama hata fırlatmazsa siteye ulaşıldı demektir
        this.log('info', 'Rollback doğrulama isteği tamamlandı', { siteUrl, type: response.type });
        
        return { 
          success: true, 
          siteUrl, 
          checked: true, 
          method: 'HEAD-no-cors',
          timestamp: new Date().toISOString()
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        // no-cors hatası değilse (network error, timeout vb.)
        if (fetchError.name !== 'AbortError') {
          this.log('warn', 'Rollback doğrulama fetch hatası', { error: fetchError.message, siteUrl });
        }
        
        // Fallback: Image yükleme ile kontrol (no-cors çalışmazsa)
        return await this.verifyWithImageLoad(siteUrl);
      }
    } catch (error) {
      this.log('error', 'Rollback doğrulama kritik hatası', { error: error.message });
      return { success: false, error: error.message, checked: true, siteUrl };
    }
  }

  /**
   * Image yükleme ile site erişilebilirlik kontrolü (fallback)
   * @param {string} siteUrl 
   * @returns {Promise<Object>}
   */
  async verifyWithImageLoad(siteUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      const timeout = setTimeout(() => {
        resolve({ 
          success: false, 
          error: 'Timeout', 
          siteUrl, 
          checked: true, 
          method: 'image-load',
          timestamp: new Date().toISOString()
        });
      }, 10000);
      
      img.onload = () => {
        clearTimeout(timeout);
        resolve({ 
          success: true, 
          siteUrl, 
          checked: true, 
          method: 'image-load',
          timestamp: new Date().toISOString()
        });
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        // onerror da siteye ulaşıldı demek olabilir (CORS hatası vs)
        // ama güvenli taraf: başarısız say
        resolve({ 
          success: false, 
          error: 'Image load error (CORS veya site kapalı)', 
          siteUrl, 
          checked: true, 
          method: 'image-load',
          timestamp: new Date().toISOString()
        });
      };
      
      // Favicon veya küçük bir kaynak yükle
      img.src = `${siteUrl}favicon.ico?t=${Date.now()}`;
    });
  }

  /**
   * Rollback geçmişini localStorage'a kaydet
   * @param {Object} result - rollbackTest sonucu
   */
  saveRollbackHistory(result) {
    try {
      const historyKey = 'hafize_rollback_history';
      let history = [];
      
      const stored = localStorage.getItem(historyKey);
      if (stored) {
        history = JSON.parse(stored);
      }
      
      const entry = {
        ...result,
        timestamp: new Date().toISOString(),
        testMode: this.getTestMode()
      };
      
      history.unshift(entry);
      
      // Son 50 kayıt tut
      if (history.length > 50) {
        history = history.slice(0, 50);
      }
      
      localStorage.setItem(historyKey, JSON.stringify(history));
      
      this.log('debug', 'Rollback geçmişi kaydedildi', { count: history.length });
    } catch (e) {
      this.log('warn', 'Rollback geçmişi kaydedilemedi', { error: e.message });
    }
  }

  /**
   * Rollback geçmişini getir
   * @returns {Array}
   */
  getRollbackHistory() {
    try {
      const stored = localStorage.getItem('hafize_rollback_history');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Rollback geçmişini temizle
   */
  clearRollbackHistory() {
    try {
      localStorage.removeItem('hafize_rollback_history');
      this.log('info', 'Rollback geçmişi temizlendi');
    } catch (e) {
      this.log('warn', 'Rollback geçmişi temizlenemedi', { error: e.message });
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
    
    // Chart instance'larını temizle - try/catch ile güvenli destroy
    Object.keys(this.chartInstances).forEach(key => {
      const chart = this.chartInstances[key];
      if (chart && typeof chart.destroy === 'function') {
        try {
          chart.destroy();
        } catch (e) {
          this.log('warn', `Chart destroy hatası (${key}):`, { error: e.message });
        }
      }
      this.chartInstances[key] = null;
    });
    this.chartInstances = {
      workflowTrend: null,
      deployTimes: null,
      rollbackTrend: null,
      testSuccessRate: null
    };
    
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
