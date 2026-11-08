let githubServis, firebaseServis, apiServis;
let chartWorkflowTrend = null;
let chartDeployTimes = null;

async function initServices() {
  if (typeof window.Config === 'undefined' || typeof window.GithubServis === 'undefined' || typeof window.FirebaseServis === 'undefined' || typeof window.ApiServis === 'undefined' || typeof window.LoggerServis === 'undefined' || typeof window.PerformanceServis === 'undefined') {
    throw new Error('Gerekli modüller henüz yüklenmedi');
  }
  githubServis = new window.GithubServis(window.Config);
  firebaseServis = new window.FirebaseServis(window.Config);
  apiServis = new window.ApiServis(window.Config);
  
  // Logger ve Performance servislerini başlat (modüller zaten window'a atıyor)
  new window.LoggerServis();
  window.performanceServis = new window.PerformanceServis(window.Config);
  window.performanceServis.init();
  
  // Global erişim için (debug amaçlı)
  window.githubServis = githubServis;
  window.firebaseServis = firebaseServis;
  window.apiServis = apiServis;
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
    const [githubVerisi, firebaseVerisi, workflowVerisi] = await Promise.allSettled([
      githubServis.tumVeriyiAl(),
      firebaseServis.tumVeriyiAl(),
      apiServis.tumVeriyiAl()
    ]);

    const github = githubVerisi.status === 'fulfilled' ? githubVerisi.value : { commits: [], workflowRuns: [], repo: {} };
    const firebase = firebaseVerisi.status === 'fulfilled' ? firebaseVerisi.value : { siteDurumu: 'Hata', sonDeploy: null, releases: [], site: null };
    const workflow = workflowVerisi.status === 'fulfilled' ? workflowVerisi.value : { 
      workflowDurumu: 'Bilinmiyor', 
      workflowConclusion: 'Bilinmiyor', 
      latestRun: null, 
      workflowRuns: [], 
      rollback: { executed: false } 
    };

    // Performans metriklerini al
    let performanceMetrics = {};
    if (window.performanceServis) {
      performanceMetrics = window.performanceServis.getMetrics();
    }

    const birlesikVeri = {
      github,
      firebase,
      workflow,
      performance: performanceMetrics,
      yuklenmeZamani: new Date()
    };

    updateUI(birlesikVeri);
    return birlesikVeri;
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
}

window.initApp = initApp;
window.loadDashboardData = loadDashboardData;
window.updateUI = updateUI;
window.formatDateTR = formatDateTR;
window.showError = showError;

// FAB butonları için event listener'ları ekle
document.addEventListener('DOMContentLoaded', () => {
  // Butonları seç
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
  
  // Notify servisi henüz yüklenmediyse başlat
  if (typeof window.NotifyServis !== 'undefined' && !window.notifyServis) {
    window.notifyServis = new window.NotifyServis();
  }
  
  // Performance update event listener
  window.addEventListener('performance-update', (event) => {
    if (event.detail) {
      const perf = event.detail;
      const perfLcpEl = document.getElementById('perf-lcp');
      const perfFidEl = document.getElementById('perf-fid');
      const perfClsEl = document.getElementById('perf-cls');
      const statsPerformansEl = document.getElementById('stats-performans');
      
      if (perf.lcp && perfLcpEl) {
        perfLcpEl.textContent = perf.lcp.value + 'ms';
        perfLcpEl.className = 'stat-value ' + (perf.lcp.rating === 'good' ? 'badge-success' : perf.lcp.rating === 'needs-improvement' ? 'badge-warning' : 'badge-danger');
      }
      if (perf.fid && perfFidEl) {
        perfFidEl.textContent = perf.fid.value + 'ms';
        perfFidEl.className = 'stat-value ' + (perf.fid.rating === 'good' ? 'badge-success' : perf.fid.rating === 'needs-improvement' ? 'badge-warning' : 'badge-danger');
      }
      if (perf.cls && perfClsEl) {
        perfClsEl.textContent = perf.cls.value;
        perfClsEl.className = 'stat-value ' + (perf.cls.rating === 'good' ? 'badge-success' : perf.cls.rating === 'needs-improvement' ? 'badge-warning' : 'badge-danger');
      }
      if (statsPerformansEl) {
        statsPerformansEl.style.display = 'grid';
      }
      
      // Performance panelini de güncelle
      const perfLcpVal = document.getElementById('perf-lcp-val');
      const perfFidVal = document.getElementById('perf-fid-val');
      const perfClsVal = document.getElementById('perf-cls-val');
      const perfFcpVal = document.getElementById('perf-fcp-val');
      const perfTtfbVal = document.getElementById('perf-ttfb-val');
      
      if (perf.lcp && perfLcpVal) {
        perfLcpVal.textContent = perf.lcp.value + 'ms';
        perfLcpVal.parentElement.className = 'perf-metric ' + (perf.lcp.rating === 'good' ? 'perf-good' : perf.lcp.rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor');
      }
      if (perf.fid && perfFidVal) {
        perfFidVal.textContent = perf.fid.value + 'ms';
        perfFidVal.parentElement.className = 'perf-metric ' + (perf.fid.rating === 'good' ? 'perf-good' : perf.fid.rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor');
      }
      if (perf.cls && perfClsVal) {
        perfClsVal.textContent = perf.cls.value;
        perfClsVal.parentElement.className = 'perf-metric ' + (perf.cls.rating === 'good' ? 'perf-good' : perf.cls.rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor');
      }
      if (perf.fcp && perfFcpVal) {
        perfFcpVal.textContent = perf.fcp.value + 'ms';
        perfFcpVal.parentElement.className = 'perf-metric ' + (perf.fcp.rating === 'good' ? 'perf-good' : perf.fcp.rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor');
      }
      if (perf.ttfb && perfTtfbVal) {
        perfTtfbVal.textContent = perf.ttfb.value + 'ms';
        perfTtfbVal.parentElement.className = 'perf-metric ' + (perf.ttfb.rating === 'good' ? 'perf-good' : perf.ttfb.rating === 'needs-improvement' ? 'perf-needs-improvement' : 'perf-poor');
      }
    }
  });
  
  if (typeof window.initApp === 'function') {
    window.initApp();
  }
});

// Global erişim için (debug amaçlı)
window.githubServis = githubServis;
window.firebaseServis = firebaseServis;
window.apiServis = apiServis;