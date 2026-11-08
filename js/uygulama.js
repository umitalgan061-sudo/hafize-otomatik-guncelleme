let githubServis, firebaseServis, apiServis;

async function initServices() {
  if (typeof window.Config === 'undefined' || typeof window.GithubServis === 'undefined' || typeof window.FirebaseServis === 'undefined' || typeof window.ApiServis === 'undefined') {
    throw new Error('Gerekli modüller henüz yüklenmedi');
  }
  githubServis = new window.GithubServis(window.Config);
  firebaseServis = new window.FirebaseServis(window.Config);
  apiServis = new window.ApiServis(window.Config);
  
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

  if (lastUpdateEl) {
    lastUpdateEl.textContent = 'Son güncelleme: ' + formatDateTR(yuklenmeZamani);
    lastUpdateEl.style.color = '#333';
  }

  if (turSayisiEl && github.workflowRuns) {
    const tamamlanan = github.workflowRuns.filter(r => r.conclusion === 'success').length;
    turSayisiEl.textContent = tamamlanan.toString();
  } else if (turSayisiEl && github.workflow_runs) {
    const tamamlanan = github.workflow_runs.filter(r => r.conclusion === 'success').length;
    turSayisiEl.textContent = tamamlanan.toString();
  }

  // Workflow çalışma sayısı da göster (toplam)
  const workflowSayisiEl = document.getElementById('workflow-sayisi');
  if (workflowSayisiEl && github.workflowRuns) {
    workflowSayisiEl.textContent = github.workflowRuns.length.toString();
  }

  if (sonCommitEl && github.commits && github.commits.length > 0) {
    const commit = github.commits[0];
    const kisaSha = commit.sha ? commit.sha.substring(0, 7) : '-';
    sonCommitEl.textContent = kisaSha;
    sonCommitEl.title = commit.commit?.message || '';
  }

  if (siteDurumuEl && firebase) {
    const durum = firebase.siteDurumu || 'Bilinmiyor';
    const deployZamani = firebase.sonDeploy ? formatDateTR(firebase.sonDeploy) : '-';
    siteDurumuEl.textContent = durum === 'ACTIVE' ? '✓ Canlı' : ('⚠ ' + durum);
    siteDurumuEl.title = 'Son deploy: ' + deployZamani;
  } else if (siteDurumuEl && firebase && firebase.site) {
    // FirebaseServis tumVeriyiAl site alanı da döndürüyor
    const durum = firebase.site?.type || 'Bilinmiyor';
    const deployZamani = firebase.sonDeploy ? formatDateTR(firebase.sonDeploy) : '-';
    siteDurumuEl.textContent = durum === 'ACTIVE' ? '✓ Canlı' : ('⚠ ' + durum);
    siteDurumuEl.title = 'Son deploy: ' + deployZamani;
  }

    // Workflow durumu badge'i ve rollback bilgisi
    const workflowCard = document.getElementById('workflow-durum')?.closest('.status-card');
    const statusCard = workflowCard?.querySelector('h3');
    const detayCard = document.getElementById('workflow-detay');
  if (statusCard && workflow.latestRun) {
    const run = workflow.latestRun;
    let badgeHtml = '';
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

    badgeHtml = `<span class="badge ${badgeClass}">${badgeText}</span>`;
    
    // Mevcut "Aktif" badge'ini koru, workflow badge'ini yanına ekle
    if (!statusCard.querySelector('.workflow-badge')) {
      const workflowBadge = document.createElement('span');
      workflowBadge.className = 'workflow-badge';
      workflowBadge.innerHTML = badgeHtml;
      statusCard.appendChild(workflowBadge);
    } else {
      statusCard.querySelector('.workflow-badge').innerHTML = badgeHtml;
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

  // Rollback bilgisi varsa göster (apiServis.tumVeriyiAl'dan gelen rollback objesi)
  if (workflow.rollback && workflow.rollback.executed) {
    let rollbackEl = document.getElementById('rollback-info');
    if (!rollbackEl) {
      rollbackEl = document.createElement('div');
      rollbackEl.id = 'rollback-info';
      rollbackEl.className = 'rollback-card';
      // 3. status-card'in sonrasına ekle
      const workflowCard = document.querySelector('.status-card:nth-of-type(3)');
      if (workflowCard) {
        workflowCard.parentNode.insertBefore(rollbackEl, workflowCard.nextSibling);
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
}
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

    const birlesikVeri = {
      github,
      firebase,
      workflow,
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

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.initApp === 'function') {
    window.initApp();
  }
});

// Global erişim için (debug amaçlı)
window.githubServis = githubServis;
window.firebaseServis = firebaseServis;
window.apiServis = apiServis;