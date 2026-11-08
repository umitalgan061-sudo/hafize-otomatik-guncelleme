import { Config } from '../config.js';
import { GithubServis } from './servisler/github.js';
import { FirebaseServis } from './servisler/firebase.js';

let githubServis, firebaseServis;

async function initServices() {
  githubServis = new GithubServis(Config);
  firebaseServis = new FirebaseServis(Config);
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
  const { github, firebase, yuklenmeZamani } = data;

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
  }
}

async function loadDashboardData() {
  try {
    const [githubVerisi, firebaseVerisi] = await Promise.all([
      githubServis.tumVeriyiAl(),
      firebaseServis.tumVeriyiAl()
    ]);

    const birlesikVeri = {
      github: githubVerisi,
      firebase: firebaseVerisi,
      yuklenmeZamani: new Date()
    };

    updateUI(birlesikVeri);
    return birlesikVeri;
  } catch (hata) {
    showError('Veri yüklenemedi: ' + hata.message);
    throw hata;
  }
}

async function initApp() {
  console.log('[Hafize] Uygulama başlatılıyor...');
  try {
    await initServices();
    await loadDashboardData();
  } catch (hata) {
    showError('Başlatma hatası: ' + hata.message);
  }

  const yenilemeAraligi = Config.YENILEME_ARALIGI_MS || 30 * 60 * 1000;
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