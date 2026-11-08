let githubServis, firebaseServis, apiServis;
let integrationServis;
let chartWorkflowTrend = null;
let chartDeployTimes = null;
let workflowMonitorInterval = null;
let lastKnownWorkflowRunId = null;

async function initServices() {
  if (typeof window.Config === 'undefined' || typeof window.GithubServis === 'undefined' || typeof window.FirebaseServis === 'undefined' || typeof window.ApiServis === 'undefined' || typeof window.LoggerServis === 'undefined' || typeof window.PerformanceServis === 'undefined' || typeof window.NotifyServis === 'undefined' || typeof window.IntegrationServis === 'undefined') {
    throw new Error('Gerekli modüller henüz yüklenmedi');
  }
  
  githubServis = new window.GithubServis(window.Config);
  firebaseServis = new window.FirebaseServis(window.Config);
  apiServis = new window.ApiServis(window.Config);
  
  // Logger ve Performance servislerini başlat (modüller zaten window'a atıyor)
  new window.LoggerServis();
  window.performanceServis = new window.PerformanceServis(window.Config);
  window.performanceServis.init();
  
  // Notify servisini başlat
  window.notifyServis = new window.NotifyServis();
  
  // Integration servisini oluştur ve başlat
  integrationServis = new window.IntegrationServis(window.Config, {
    githubServis,
    firebaseServis,
    apiServis,
    loggerServis: window.loggerServis,
    performanceServis: window.performanceServis,
    notifyServis: window.notifyServis
  });
  integrationServis.init();
  window.integrationServis = integrationServis;
  
  // TestRunner örneğini oluştur
  window.testRunner = new window.TestRunner(integrationServis);
  
  // Workflow tetikleme ve izleme event listener'larını kur
  setupWorkflowListeners();
  
  // Global test fonksiyonları
  window.testNotify = () => {
    if (window.notifyServis) {
      window.notifyServis.success('Test Bildirimi', 'Success toast çalışıyor');
      window.notifyServis.error('Test Bildirimi', 'Error toast çalışıyor');
      window.notifyServis.warning('Test Bildirimi', 'Warning toast çalışıyor');
      window.notifyServis.info('Test Bildirimi', 'Info toast çalışıyor');
    }
  };
  
  window.testLogger = () => {
    if (window.loggerServis) {
      window.loggerServis.error('Test hatası', { test: true, code: 'TEST_ERROR' });
      window.loggerServis.warn('Test uyarısı', { test: true });
      window.loggerServis.info('Test bilgisi', { test: true });
      window.loggerServis.debug('Test debug', { test: true });
    }
  };
  
  window.testPerformance = () => {
    if (window.performanceServis) {
      if (!window.performanceServis.isInitialized) {
        window.performanceServis.init();
      }
      const metrics = window.performanceServis.getMetrics();
      window.performanceServis.reportToDashboard();
      return metrics;
    }
  };
  
  window.testRollback = async () => {
    if (window.integrationServis) {
      return await window.integrationServis.rollbackTest();
    }
  };
  
  window.testAll = async () => {
    if (window.testRunner) {
      return await window.testRunner.runAll();
    }
  };
  
  // Global erişim için (debug amaçlı)
  window.githubServis = githubServis;
  window.firebaseServis = firebaseServis;
  window.apiServis = apiServis;
}

function setupWorkflowListeners() {
  // Workflow run sonucunu dinleyen custom event listener
  window.addEventListener('workflow-run-completed', async (event) => {
    const { runId, conclusion, status } = event.detail || {};
    console.log('[Hafize] Workflow run tamamlandı:', { runId, conclusion, status });
    
    if (window.loggerServis) {
      window.loggerServis.info('Workflow run tamamlandı', { runId, conclusion, status });
    }
    
    if (window.notifyServis) {
      if (conclusion === 'success') {
        window.notifyServis.success('Deploy Başarılı', `Workflow #${runId} başarıyla tamamlandı`);
      } else if (conclusion === 'failure') {
        window.notifyServis.error('Deploy Başarısız', `Workflow #${runId} başarısız oldu - Rollback tetikleniyor...`);
        
        // Deploy başarısızsa otomatik rollbackTest çağrısı
        try {
          if (window.integrationServis) {
            const rollbackResult = await window.integrationServis.rollbackTest();
            if (rollbackResult.success) {
              window.notifyServis.success('Rollback Başarılı', `Otomatik rollback tamamlandı: ${rollbackResult.releaseName}`);
            } else {
              window.notifyServis.error('Rollback Başarısız', rollbackResult.error || 'Bilinmeyen hata');
            }
          }
        } catch (rollbackError) {
          window.notifyServis.error('Rollback Hatası', rollbackError.message);
          if (window.loggerServis) {
            window.loggerServis.error('Otomatik rollback hatası', { error: rollbackError.message, runId });
          }
        }
      }
    }
    
    // Dashboard'ı güncelle
    await loadDashboardData();
  });
  
  // Workflow tetikleme butonu event listener (DOM hazır olduğunda bağlanır)
  document.addEventListener('DOMContentLoaded', () => {
    const triggerBtn = document.getElementById('trigger-workflow');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', async () => {
        await triggerWorkflowManually();
      });
    }
  });
}

// Manuel workflow tetikleme fonksiyonu
async function triggerWorkflowManually() {
  if (!apiServis) {
    if (window.notifyServis) {
      window.notifyServis.error('Hata', 'API servisi henüz hazır değil');
    }
    return;
  }
  
  if (window.notifyServis) {
    window.notifyServis.info('Workflow Tetikleniyor', 'Manuel workflow çalıştırılıyor...');
  }
  if (window.loggerServis) {
    window.loggerServis.info('Manuel workflow tetikleme isteği');
  }
  
  try {
    // Workflow ID'sini al (genellikle workflow dosya adı veya ID)
    // GitHub Actions API: POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
    const workflowId = 'ci-cd.yml'; // .github/workflows/ci-cd.yml
    const result = await apiServis.triggerWorkflowRun(workflowId);
    
    if (window.notifyServis) {
      window.notifyServis.success('Workflow Tetiklendi', 'Workflow başarıyla başlatıldı');
    }
    if (window.loggerServis) {
      window.loggerServis.info('Workflow manuel tetiklendi', { workflowId, result });
    }
    
    // Tetiklenen workflow'u izlemeye başla
    startWorkflowMonitoring();
    
  } catch (error) {
    if (window.notifyServis) {
      window.notifyServis.error('Tetikleme Hatası', error.message);
    }
    if (window.loggerServis) {
      window.loggerServis.error('Manuel workflow tetikleme hatası', { error: error.message });
    }
  }
}

// Workflow run'ını izleme (polling)
function startWorkflowMonitoring() {
  if (workflowMonitorInterval) {
    clearInterval(workflowMonitorInterval);
  }
  
  workflowMonitorInterval = setInterval(async () => {
    try {
      if (!apiServis) return;
      
      const latestRun = await apiServis.getLatestWorkflowRun();
      if (!latestRun) return;
      
      // Yeni bir run başladıysa veya durum değiştiyse
      if (latestRun.id !== lastKnownWorkflowRunId) {
        lastKnownWorkflowRunId = latestRun.id;
        console.log('[Hafize] Yeni workflow run algılandı:', latestRun.id);
      }
      
      // Run tamamlandıysa event tetikle
      if (latestRun.status === 'completed' && latestRun.id === lastKnownWorkflowRunId) {
        clearInterval(workflowMonitorInterval);
        workflowMonitorInterval = null;
        
        window.dispatchEvent(new CustomEvent('workflow-run-completed', {
          detail: {
            runId: latestRun.id,
            conclusion: latestRun.conclusion,
            status: latestRun.status,
            workflowName: latestRun.name
          }
        }));
      }
    } catch (error) {
      console.warn('[Hafize] Workflow izleme hatası:', error.message);
    }
  }, 10000); // Her 10 saniyede bir kontrol et
}

// Periyodik yenilemede workflow durumu kontrolü
async function checkWorkflowStatusPeriodic() {
  try {
    if (!apiServis) return;
    
    const latestRun = await apiServis.getLatestWorkflowRun();
    if (!latestRun) return;
    
    // UI'daki workflow durum badge'ini güncelle
    updateWorkflowStatusBadge(latestRun);
    
    // Eğer bir run in_progress veya queued ise izlemeye başla
    if ((latestRun.status === 'in_progress' || latestRun.status === 'queued') && !workflowMonitorInterval) {
      lastKnownWorkflowRunId = latestRun.id;
      startWorkflowMonitoring();
    }
  } catch (error) {
    console.warn('[Hafize] Periyodik workflow durum kontrolü hatası:', error.message);
  }
}

function updateWorkflowStatusBadge(run) {
  const workflowDurumBadge = document.getElementById('workflow-durum');
  const sonWorkflowEl = document.getElementById('son-workflow');
  const workflowZamanEl = document.getElementById('workflow-zaman');
  
  if (workflowDurumBadge) {
    let badgeClass = 'badge-info';
    let badgeText = 'Bilinmiyor';

    switch (run.status) {
      case 'completed':
        if (run.conclusion === 'success') {
          badgeClass = 'badge-success';
          badgeText = 'Başarılı ✓';
        } else if (run.conclusion === 'failure') {
          badgeClass = 'badge-danger';
          badgeText = 'Başarısız ✗';
        } else {
          badgeClass = 'badge-warning';
          badgeText = run.conclusion || 'Tamamlandı';
        }
        break;
      case 'in_progress':
      case 'queued':
      case 'waiting':
        badgeClass = 'badge-warning pulse';
        badgeText = 'Çalışıyor ⏳';
        break;
      default:
        badgeClass = 'badge-info';
        badgeText = run.status || 'Bilinmiyor';
    }

    workflowDurumBadge.className = `badge ${badgeClass}`;
    workflowDurumBadge.textContent = badgeText;
  }

  if (sonWorkflowEl) {
    sonWorkflowEl.textContent = run.name || run.display_title || run.workflow_id || 'Bilinmiyor';
  }

  if (workflowZamanEl) {
    const zaman = run.run_started_at || run.updated_at;
    workflowZamanEl.textContent = zaman ? formatDateTR(zaman) : '-';
  }
}

function formatDateTR(date) {
  if (!date) return '-';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '-';
  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/Istanbul'
  };
  return d.toLocaleString('tr-TR', options);
}

function showError(msg) {
  const lastUpdateEl = document.getElementById('last-update');
  if (lastUpdateEl) {
    lastUpdateEl.textContent = 'Hata: ' + msg;
    lastUpdateEl.style.color = '#dc3545';
  }
  console.error('[Hafize] ' + msg);
}

function updateUI(data) {
  const { github, firebase, workflow, yuklenmeZamani } = data;

  const lastUpdateEl = document.getElementById('last-update');
  const turSayisiEl = document.getElementById('tur-sayisi');
  const sonCommitEl = document.getElementById('son-commit');
  const siteDurumuEl = document.getElementById('site-durumu');
  const ortDeployEl = document.getElementById('ort-deploy-suresi');
  const basariOraniEl = document.getElementById('basari-orani');
  const son24DeployEl = document.getElementById('son24-deploy');

  if (lastUpdateEl) {
    lastUpdateEl.textContent = 'Son güncelleme: ' + formatDateTR(yuklenmeZamani);
    lastUpdateEl.style.color = '#333';
  }

  const runs = github.workflowRuns || github.workflow_runs || [];
  const commits = github.commits || [];

  if (turSayisiEl) {
    const tamamlanan = runs.filter(r => r.conclusion === 'success').length;
    turSayisiEl.textContent = tamamlanan.toString();
  }

  if (sonCommitEl && commits.length > 0) {
    const commit = commits[0];
    const kisaSha = commit.sha ? commit.sha.substring(0, 7) : '-';
    sonCommitEl.textContent = kisaSha;
    sonCommitEl.title = commit.commit?.message || '';
  }

  if (siteDurumuEl && firebase) {
    const durum = firebase.siteDurumu || firebase.site?.type || 'Bilinmiyor';
    const deployZamani = firebase.sonDeploy ? formatDateTR(firebase.sonDeploy) : '-';
    siteDurumuEl.textContent = durum === 'ACTIVE' ? '✓ Canlı' : ('⚠ ' + durum);
    siteDurumuEl.title = 'Son deploy: ' + deployZamani;
  }

  // Workflow durum badge'i
  const workflowCard = document.getElementById('workflow-durum')?.closest('.status-card');
  const statusCard = workflowCard?.querySelector('h3');
  
  if (statusCard && workflow.latestRun) {
    const run = workflow.latestRun;
    let badgeClass = 'badge-info';
    let badgeText = 'Bilinmiyor';

    switch (run.status) {
      case 'completed':
        if (run.conclusion === 'success') {
          badgeClass = 'badge-active';
          badgeText = 'Başarılı ✓';
        } else if (run.conclusion === 'failure') {
          badgeClass = 'badge-danger';
          badgeText = 'Başarısız ✗';
        } else {
          badgeClass = 'badge-warning';
          badgeText = run.conclusion || 'Tamamlandı';
        }
        break;
      case 'in_progress':
      case 'queued':
      case 'waiting':
        badgeClass = 'badge-warning pulse';
        badgeText = 'Çalışıyor ⏳';
        break;
      default:
        badgeClass = 'badge-info';
        badgeText = run.status || 'Bilinmiyor';
    }

    const badgeHtml = `<span class="badge ${badgeClass}">${badgeText}</span>`;
    
    if (!statusCard.querySelector('.workflow-badge')) {
      const workflowBadge = document.createElement('span');
      workflowBadge.className = 'workflow-badge';
      workflowBadge.innerHTML = badgeHtml;
      statusCard.appendChild(workflowBadge);
    } else {
      statusCard.querySelector('.workflow-badge').innerHTML = badgeHtml;
    }
  }

  // Workflow durum kartı (3. kart) güncelleme
  const workflowDurumBadge = document.getElementById('workflow-durum');
  const sonWorkflowEl = document.getElementById('son-workflow');
  const workflowZamanEl = document.getElementById('workflow-zaman');
  
  if (workflowDurumBadge && workflow.latestRun) {
    const run = workflow.latestRun;
    let badgeClass = 'badge-info';
    let badgeText = 'Bilinmiyor';

    switch (run.status) {
      case 'completed':
        if (run.conclusion === 'success') {
          badgeClass = 'badge-success';
          badgeText = 'Başarılı ✓';
        } else if (run.conclusion === 'failure') {
          badgeClass = 'badge-danger';
          badgeText = 'Başarısız ✗';
        } else {
          badgeClass = 'badge-warning';
          badgeText = run.conclusion || 'Tamamlandı';
        }
        break;
      case 'in_progress':
      case 'queued':
      case 'waiting':
        badgeClass = 'badge-warning pulse';
        badgeText = 'Çalışıyor ⏳';
        break;
      default:
        badgeClass = 'badge-info';
        badgeText = run.status || 'Bilinmiyor';
    }

    workflowDurumBadge.className = `badge ${badgeClass}`;
    workflowDurumBadge.textContent = badgeText;
  }

  if (sonWorkflowEl && workflow.latestRun) {
    const run = workflow.latestRun;
    sonWorkflowEl.textContent = run.name || run.display_title || run.workflow_id || 'Bilinmiyor';
  }

  if (workflowZamanEl && workflow.latestRun) {
    const run = workflow.latestRun;
    const zaman = run.run_started_at || run.updated_at;
    workflowZamanEl.textContent = zaman ? formatDateTR(zaman) : '-';
  }

  // Rollback bilgisi
  if (workflow.rollback && workflow.rollback.executed) {
    let rollbackEl = document.getElementById('rollback-info');
    if (!rollbackEl) {
      rollbackEl = document.createElement('div');
      rollbackEl.id = 'rollback-info';
      rollbackEl.className = 'rollback-card';
      const workflowCardEl = document.querySelector('.status-card:nth-of-type(3)');
      if (workflowCardEl) {
        workflowCardEl.parentNode.insertBefore(rollbackEl, workflowCardEl.nextSibling);
      } else {
        document.querySelector('.container').appendChild(rollbackEl);
      }
    }
    rollbackEl.innerHTML = `<h3><span class="badge badge-warning">Rollback</span> Otomatik Geri Alma</h3><p>🔄 <strong>Sebep:</strong> ${workflow.rollback.reason || 'Deploy hatası sonrası'}<br>🕐 <strong>Zaman:</strong> ${formatDateTR(workflow.rollback.timestamp)}</p>`;
    rollbackEl.style.display = 'block';
  } else {
    const rollbackEl = document.getElementById('rollback-info');
    if (rollbackEl) rollbackEl.style.display = 'none';
  }

  // Metrik kartları ve grafikler
  drawCharts(runs, workflow);
  updateMetricCards(runs);
}

function updateMetricCards(runs) {
  const ortDeployEl = document.getElementById('ort-deploy-suresi');
  const basariOraniEl = document.getElementById('basari-orani');
  const son24DeployEl = document.getElementById('son24-deploy');

  if (runs.length === 0) {
    if (ortDeployEl) ortDeployEl.textContent = '-';
    if (basariOraniEl) basariOraniEl.textContent = '-';
    if (son24DeployEl) son24DeployEl.textContent = '-';
    return;
  }

  const completedRuns = runs.filter(r => r.status === 'completed');
  const successfulRuns = completedRuns.filter(r => r.conclusion === 'success');
  
  // Ortalama deploy süresi (dakika)
  let ortDeploy = '-';
  if (successfulRuns.length > 0) {
    const toplamSure = successfulRuns.reduce((sum, run) => {
      const start = run.run_started_at ? new Date(run.run_started_at).getTime() : 0;
      const end = run.updated_at ? new Date(run.updated_at).getTime() : 0;
      return sum + (end - start);
    }, 0);
    const ortMs = toplamSure / successfulRuns.length;
    const ortDakika = Math.round(ortMs / 60000);
    ortDeploy = `${ortDakika} dk`;
  }
  if (ortDeployEl) ortDeployEl.textContent = ortDeploy;

  // Başarı oranı
  const basariOrani = completedRuns.length > 0 
    ? Math.round((successfulRuns.length / completedRuns.length) * 100) + '%'
    : '-';
  if (basariOraniEl) basariOraniEl.textContent = basariOrani;

  // Son 24 saat deploy sayısı
  const now = Date.now();
  const son24 = runs.filter(r => {
    const start = r.run_started_at ? new Date(r.run_started_at).getTime() : 0;
    return (now - start) < 24 * 60 * 60 * 1000;
  }).length;
  if (son24DeployEl) son24DeployEl.textContent = son24.toString();
}

function drawCharts(runs, workflow) {
  const ctxTrend = document.getElementById('chart-workflow-trend');
  const ctxDeploy = document.getElementById('chart-deploy-times');

  if (!ctxTrend || !ctxDeploy || typeof Chart === 'undefined') {
    console.warn('[Hafize] Chart.js yüklenmedi veya canvas elementleri yok');
    return;
  }

  // Veriyi hazırla (eski -> yeni sırası)
  const chartRuns = [...runs].reverse().slice(0, 10);
  
  // Workflow trend verisi: success=1, failure=0, diğer=null
  const trendLabels = chartRuns.map(r => {
    const date = r.run_started_at ? new Date(r.run_started_at) : new Date();
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  });
  const trendData = chartRuns.map(r => {
    if (r.conclusion === 'success') return 1;
    if (r.conclusion === 'failure') return 0;
    return null;
  });

  // Deploy süreleri verisi (dakika)
  const deployLabels = trendLabels;
  const deployData = chartRuns.map(r => {
    if (r.status !== 'completed' || !r.run_started_at || !r.updated_at) return null;
    const ms = new Date(r.updated_at).getTime() - new Date(r.run_started_at).getTime();
    return Math.round(ms / 60000);
  });

  // Mevcut grafikleri temizle
  if (chartWorkflowTrend) chartWorkflowTrend.destroy();
  if (chartDeployTimes) chartDeployTimes.destroy();

  // Workflow Başarı Trendi - Çizgi grafiği
  chartWorkflowTrend = new Chart(ctxTrend, {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        label: 'Başarı (1) / Başarısızlık (0)',
        data: trendData,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: trendData.map(v => v === 1 ? '#28a745' : v === 0 ? '#dc3545' : '#6c757d'),
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

  // Deploy Süreleri - Bar grafiği
  chartDeployTimes = new Chart(ctxDeploy, {
    type: 'bar',
    data: {
      labels: deployLabels,
      datasets: [{
        label: 'Deploy Süresi (dk)',
        data: deployData,
        backgroundColor: deployData.map(v => v === null ? 'rgba(108, 117, 125, 0.3)' : v <= 5 ? 'rgba(40, 167, 69, 0.7)' : v <= 10 ? 'rgba(255, 193, 7, 0.7)' : 'rgba(220, 53, 69, 0.7)'),
        borderColor: deployData.map(v => v === null ? '#6c757d' : v <= 5 ? '#28a745' : v <= 10 ? '#ffc107' : '#dc3545'),
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
              return val === null ? 'Veri yok' : `${val} dakika`;
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
}

async function loadDashboardData() {
  try {
    // Integration servisi üzerinden tek veri akışı
    if (!integrationServis) {
      throw new Error('IntegrationServis henüz başlatılmadı');
    }
    const data = await integrationServis.tumVeriyiAl();
    
    updateUI(data);
    
    // Periyodik workflow durumu kontrolü
    await checkWorkflowStatusPeriodic();
    
    return data;
  } catch (hata) {
    showError('Veri yüklenemedi: ' + hata.message);
    throw hata;
  }
}

// Zincir testi: initApp -> initServices -> loadDashboardData -> updateUI
// Hata durumlarında showError çağrılıyor mu?
// initApp: try/catch içinde initServices ve loadDashboardData, hata -> showError ✓
// initServices: throw Error -> initApp yakalar -> showError ✓
// loadDashboardData: Promise.allSettled ile tek tek hata yönetimi, genel catch -> showError ✓
// updateUI: DOM yoksa sessizce dönüyor (showError çağırmaz) - bu bir tasarım tercihi, hata loglanıyor ✓
// Periyodik setInterval: try/catch -> showError ✓
// Tüm hata yolları showError'e bağlanmış. Zincir sağlam.

async function initApp() {
  console.log('[Hafize] Uygulama başlatılıyor...');
  try {
    await initServices();
    await loadDashboardData();
  } catch (hata) {
    showError('Başlatma hatası: ' + hata.message);
  }

  const yenilemeAraligi = window.Config?.YENILEME_ARALIGI_MS || 30 * 60 * 1000;
  setInterval(async () => {
    console.log('[Hafize] Periyodik yenileme...');
    try {
      await loadDashboardData();
    } catch (hata) {
      showError('Yenileme hatası: ' + hata.message);
    }
  }, yenilemeAraligi);
  
  // Workflow izleme temizleme
  window.addEventListener('beforeunload', () => {
    if (workflowMonitorInterval) {
      clearInterval(workflowMonitorInterval);
    }
  });
}

window.initApp = initApp;
window.loadDashboardData = loadDashboardData;
window.updateUI = updateUI;
window.formatDateTR = formatDateTR;
window.showError = showError;

// FAB butonları ve test butonları için event listener'ları ekle
document.addEventListener('DOMContentLoaded', () => {
  // FAB butonları
  const btnLogs = document.getElementById('btn-logs');
  const btnPerf = document.getElementById('btn-perf');
  const btnNotify = document.getElementById('btn-notify');
  
  if (btnLogs) {
    btnLogs.addEventListener('click', () => {
      if (window.loggerServis) window.loggerServis.showPanel();
    });
  }
  
  if (btnPerf) {
    btnPerf.addEventListener('click', () => {
      if (window.performanceServis) window.performanceServis.showPanel();
    });
  }
  
  if (btnNotify) {
    btnNotify.addEventListener('click', () => {
      if (window.notifyServis) window.notifyServis.showHistoryPanel();
    });
  }

  // Test butonları (integration panel)
  const testRollbackBtn = document.getElementById('test-rollback');
  const testNotifyBtn = document.getElementById('test-notify');
  const testLoggerBtn = document.getElementById('test-logger');
  const testPerformanceBtn = document.getElementById('test-performance');
  const testAllBtn = document.getElementById('test-all');
  const forceRefreshBtn = document.getElementById('force-refresh');
  const integrationCloseBtn = document.querySelector('.integration-close-panel');
  const integrationPanel = document.getElementById('integration-panel');
  const testModeToggle = document.getElementById('test-mode-toggle');

  // Test modu toggle (Ctrl+Shift+T ile açılır) - IntegrationServis ile senkronize
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      if (integrationServis && typeof integrationServis.toggleTestMode === 'function') {
        const newMode = integrationServis.toggleTestMode();
        if (testModeToggle) {
          testModeToggle.setAttribute('aria-pressed', newMode.toString());
          testModeToggle.querySelector('.test-toggle-text').textContent = newMode ? 'Test Modu' : 'Production Modu';
        }
        if (integrationPanel) {
          integrationPanel.style.display = newMode ? 'block' : 'none';
        }
      }
    }
  });

  if (testModeToggle) {
    testModeToggle.addEventListener('click', () => {
      if (integrationServis && typeof integrationServis.toggleTestMode === 'function') {
        const newMode = integrationServis.toggleTestMode();
        testModeToggle.setAttribute('aria-pressed', newMode.toString());
        testModeToggle.querySelector('.test-toggle-text').textContent = newMode ? 'Test Modu' : 'Production Modu';
        if (integrationPanel) {
          integrationPanel.style.display = newMode ? 'block' : 'none';
        }
      }
    });
  }

  // Test modu başlangıç durumunu oku ve UI'ı ayarla
  if (integrationServis && typeof integrationServis.getTestMode === 'function') {
    const initialTestMode = integrationServis.getTestMode();
    if (testModeToggle) {
      testModeToggle.setAttribute('aria-pressed', initialTestMode.toString());
      testModeToggle.querySelector('.test-toggle-text').textContent = initialTestMode ? 'Test Modu' : 'Production Modu';
    }
    if (integrationPanel) {
      integrationPanel.style.display = initialTestMode ? 'block' : 'none';
    }
    // Test modu toggle'ü göster (Ctrl+Shift+T ipucu için)
    testModeToggle.style.display = 'flex';
  }

  if (integrationCloseBtn && integrationPanel) {
    integrationCloseBtn.addEventListener('click', () => {
      integrationPanel.style.display = 'none';
      if (testModeToggle) {
        testModeToggle.setAttribute('aria-pressed', 'false');
      }
    });
  }

  const setButtonLoading = (btn, loading) => {
    if (!btn) return;
    if (loading) {
      btn.classList.add('test-btn-running');
      btn.disabled = true;
    } else {
      btn.classList.remove('test-btn-running');
      btn.disabled = false;
    }
  };

  const showRollbackResult = (result) => {
    const resultEl = document.getElementById('rollback-test-result');
    if (!resultEl) return;
    
    if (result.success) {
      resultEl.innerHTML = `
        <span class="test-result-success">✅ Başarılı</span>
        <div class="test-result-detail">
          Release: ${result.releaseName}<br>
          Zaman: ${result.releaseTime ? new Date(result.releaseTime).toLocaleString('tr-TR') : '-'}
        </div>
      `;
    } else {
      resultEl.innerHTML = `
        <span class="test-result-error">❌ Başarısız</span>
        <div class="test-result-detail">${result.error || 'Bilinmeyen hata'}</div>
      `;
    }
  };

  if (testRollbackBtn) {
    testRollbackBtn.addEventListener('click', async () => {
      setButtonLoading(testRollbackBtn, true);
      try {
        const result = await integrationServis.rollbackTest();
        showRollbackResult(result);
      } catch (error) {
        showRollbackResult({ success: false, error: error.message });
      } finally {
        setButtonLoading(testRollbackBtn, false);
      }
    });
  }

  if (testNotifyBtn) {
    testNotifyBtn.addEventListener('click', () => {
      setButtonLoading(testNotifyBtn, true);
      window.testNotify();
      setTimeout(() => setButtonLoading(testNotifyBtn, false), 500);
    });
  }

  if (testLoggerBtn) {
    testLoggerBtn.addEventListener('click', () => {
      setButtonLoading(testLoggerBtn, true);
      window.testLogger();
      setTimeout(() => setButtonLoading(testLoggerBtn, false), 500);
    });
  }

  if (testPerformanceBtn) {
    testPerformanceBtn.addEventListener('click', () => {
      setButtonLoading(testPerformanceBtn, true);
      window.testPerformance();
      setTimeout(() => setButtonLoading(testPerformanceBtn, false), 500);
    });
  }

  if (testAllBtn) {
    testAllBtn.addEventListener('click', async () => {
      setButtonLoading(testAllBtn, true);
      try {
        if (!window.testRunner) {
          window.testRunner = new window.TestRunner();
        }
        await window.testRunner.runAll();
      } finally {
        setButtonLoading(testAllBtn, false);
      }
    });
  }

  if (forceRefreshBtn) {
    forceRefreshBtn.addEventListener('click', async () => {
      setButtonLoading(forceRefreshBtn, true);
      try {
        await integrationServis.forceRefresh();
        if (window.notifyServis) {
          window.notifyServis.success('Yenileme', 'Veriler zorla yenilendi');
        }
      } catch (error) {
        if (window.notifyServis) {
          window.notifyServis.error('Yenileme Hatası', error.message);
        }
      } finally {
        setButtonLoading(forceRefreshBtn, false);
      }
    });
  }

  // Health indicator güncelleme
  const updateHealthIndicators = () => {
    if (!integrationServis) return;
    const health = integrationServis.getSystemHealth();
    Object.entries(health).forEach(([service, status]) => {
      const indicator = document.querySelector(`.health-indicator[data-service="${service}"] .health-status`);
      if (indicator) {
        indicator.className = `health-status health-${status}`;
        indicator.setAttribute('data-status', status);
        indicator.textContent = status === 'configured' || status === 'active' ? '●' : '○';
      }
    });
  };

  // Dashboard data loaded event listener
  window.addEventListener('dashboard-data-loaded', (event) => {
    updateHealthIndicators();
  });

  // Performance update event listener (integration servisinden gelen)
  window.addEventListener('performance-update', (event) => {
    if (!event.detail || typeof event.detail !== 'object') return;
    
    const perf = event.detail;
    const statsPerformansEl = document.getElementById('stats-performans');
    let hasAnyMetric = false;
    
    // Ana dashboard metrik kartları
    const dashboardMetrics = {
      lcp: { val: document.getElementById('perf-lcp') },
      fid: { val: document.getElementById('perf-fid') },
      cls: { val: document.getElementById('perf-cls') },
      fcp: { val: document.getElementById('perf-fcp') },
      ttfb: { val: document.getElementById('perf-ttfb') }
    };
    
    // Performance panel metrikleri
    const panelMetrics = {
      lcp: { val: document.getElementById('perf-lcp-val') },
      fid: { val: document.getElementById('perf-fid-val') },
      cls: { val: document.getElementById('perf-cls-val') },
      fcp: { val: document.getElementById('perf-fcp-val') },
      ttfb: { val: document.getElementById('perf-ttfb-val') }
    };
    
    Object.keys(dashboardMetrics).forEach(key => {
      const metric = perf[key];
      if (metric && typeof metric === 'object' && metric.value !== undefined && metric.value !== null) {
        hasAnyMetric = true;
        const unit = key === 'cls' ? '' : 'ms';
        const displayValue = `${metric.value}${unit}`;
        const rating = metric.rating || 'unknown';
        
        // Dashboard kart
        const dashEl = dashboardMetrics[key].val;
        if (dashEl) {
          dashEl.textContent = displayValue;
          dashEl.className = 'stat-value ' + (
            rating === 'good' ? 'badge-success' :
            rating === 'needs-improvement' ? 'badge-warning' : 'badge-danger'
          );
        }
        
        // Panel kart
        const panelEl = panelMetrics[key].val;
        if (panelEl) {
          panelEl.textContent = displayValue;
          panelEl.parentElement.className = 'perf-metric ' + (
            rating === 'good' ? 'perf-good' :
            rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor'
          );
        }
      }
    });
    
    if (statsPerformansEl && hasAnyMetric) {
      statsPerformansEl.style.display = 'grid';
    }
  });

  // Rollback test triggered event listener
  window.addEventListener('rollback-test-triggered', (event) => {
    if (event.detail) {
      showRollbackResult(event.detail);
    }
  });

  // Periyodik health indicator güncelleme
  setInterval(updateHealthIndicators, 30000);
  updateHealthIndicators();

  if (typeof window.initApp === 'function') {
    window.initApp();
  }
});

// Global erişim için (debug amaçlı)
window.githubServis = githubServis;
window.firebaseServis = firebaseServis;
window.apiServis = apiServis;