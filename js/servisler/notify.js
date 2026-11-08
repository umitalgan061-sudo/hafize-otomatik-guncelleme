class NotifyServis {
  constructor() {
    this.audioContext = null;
    this.notificationPermission = Notification.permission;
    this.history = this.loadHistory();
    this.toastContainer = null;
    this.maxHistory = 50;
    this.soundEnabled = true;
    this.browserNotificationEnabled = true;
    
    this.init();
  }

  init() {
    this.createToastContainer();
    this.requestNotificationPermission();
    this.initAudioContext();
    
    // Global notify servisi olarak kaydet
    if (typeof window !== 'undefined') {
      window.notifyServis = this;
    }
  }

  createToastContainer() {
    if (document.getElementById('toast-container')) return;
    
    this.toastContainer = document.createElement('div');
    this.toastContainer.id = 'toast-container';
    this.toastContainer.setAttribute('role', 'region');
    this.toastContainer.setAttribute('aria-label', 'Bildirimler');
    this.toastContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.toastContainer);
  }

  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.warn('[Notify] Tarayıcı bildirimi desteklenmiyor');
      this.browserNotificationEnabled = false;
      return;
    }
    
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        this.notificationPermission = permission;
      } catch (e) {
        console.warn('[Notify] Bildirim izni isteği başarısız:', e);
        this.browserNotificationEnabled = false;
      }
    } else {
      this.notificationPermission = Notification.permission;
      this.browserNotificationEnabled = this.notificationPermission === 'granted';
    }
  }

  initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('[Notify] Web Audio API desteklenmiyor:', e);
      this.soundEnabled = false;
    }
  }

  loadHistory() {
    try {
      const stored = localStorage.getItem('hafize_notify_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem('hafize_notify_history', JSON.stringify(this.history));
    } catch (e) {
      console.warn('[Notify] Geçmiş kaydedilemedi:', e);
    }
  }

  addToHistory(type, title, message, timestamp = Date.now()) {
    this.history.unshift({ type, title, message, timestamp });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }
    this.saveHistory();
  }

  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
  }

  playSound(type) {
    if (!this.soundEnabled || !this.audioContext) return;
    
    const ctx = this.audioContext;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    switch (type) {
      case 'success':
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.stop(now + 0.5);
        break;
      case 'error':
        osc.frequency.setValueAtTime(349.23, now); // F4
        osc.frequency.setValueAtTime(277.18, now + 0.15); // C#4
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.stop(now + 0.6);
        break;
      case 'warning':
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.setValueAtTime(440, now + 0.15);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.stop(now + 0.4);
        break;
      case 'info':
      default:
        osc.frequency.setValueAtTime(659.25, now); // E5
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.stop(now + 0.3);
        break;
    }
    
    osc.start(now);
  }

  showBrowserNotification(title, options = {}) {
    if (!this.browserNotificationEnabled || this.notificationPermission !== 'granted') return;
    
    try {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'hafize-notify',
        renotify: true,
        ...options
      });
      
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      
      setTimeout(() => notification.close(), 5000);
    } catch (e) {
      console.warn('[Notify] Tarayıcı bildirimi gösterilemedi:', e);
    }
  }

  createToastElement(type, title, message, duration = 5000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    
    const labels = {
      success: 'Başarılı',
      error: 'Hata',
      warning: 'Uyarı',
      info: 'Bilgi'
    };
    
    toast.innerHTML = `
      <div class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${this.escapeHtml(title || labels[type])}</div>
        ${message ? `<div class="toast-message">${this.escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Kapat" type="button">×</button>
      <div class="toast-progress" style="--duration: ${duration}ms"></div>
    `;
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismissToast(toast));
    
    toast.addEventListener('mouseenter', () => toast.classList.add('toast-paused'));
    toast.addEventListener('mouseleave', () => toast.classList.remove('toast-paused'));
    
    return toast;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(type, title, message, options = {}) {
    const { duration = 5000, sound = true, browserNotification = false, persistent = false } = options;
    
    const toast = this.createToastElement(type, title, message, duration);
    
    this.toastContainer.appendChild(toast);
    
    requestAnimationFrame(() => {
      toast.classList.add('toast-show');
    });
    
    this.addToHistory(type, title, message);
    
    if (sound) this.playSound(type);
    if (browserNotification) this.showBrowserNotification(title, { body: message });
    
    if (!persistent) {
      setTimeout(() => this.dismissToast(toast), duration);
    }
    
    return toast;
  }

  dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    
    toast.addEventListener('transitionend', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, { once: true });
  }

  dismissAll() {
    const toasts = this.toastContainer?.querySelectorAll('.toast');
    toasts?.forEach(toast => this.dismissToast(toast));
  }

  success(title, message, options) {
    return this.showToast('success', title, message, options);
  }

  error(title, message, options) {
    return this.showToast('error', title, message, { ...options, duration: 8000 });
  }

  warning(title, message, options) {
    return this.showToast('warning', title, message, options);
  }

  info(title, message, options) {
    return this.showToast('info', title, message, options);
  }

  createHistoryPanel() {
    const panel = document.createElement('div');
    panel.className = 'notify-history-panel';
    panel.innerHTML = `
      <div class="notify-panel-header">
        <h3>Bildirim Geçmişi</h3>
        <div class="notify-panel-actions">
          <button class="notify-clear-btn" type="button" aria-label="Geçmişi temizle">🗑</button>
          <button class="notify-close-panel" type="button" aria-label="Paneli kapat">×</button>
        </div>
      </div>
      <div class="notify-panel-filters" role="group" aria-label="Filtrele">
        <button class="notify-filter-btn active" data-filter="all" type="button">Tümü</button>
        <button class="notify-filter-btn" data-filter="success" type="button">Başarılı</button>
        <button class="notify-filter-btn" data-filter="error" type="button">Hata</button>
        <button class="notify-filter-btn" data-filter="warning" type="button">Uyarı</button>
        <button class="notify-filter-btn" data-filter="info" type="button">Bilgi</button>
      </div>
      <div class="notify-panel-list" role="list" aria-label="Bildirim listesi"></div>
    `;
    
    const listEl = panel.querySelector('.notify-panel-list');
    const filterBtns = panel.querySelectorAll('.notify-filter-btn');
    const clearBtn = panel.querySelector('.notify-clear-btn');
    const closeBtn = panel.querySelector('.notify-close-panel');
    
    let currentFilter = 'all';
    
    const render = () => {
      const filtered = currentFilter === 'all' 
        ? this.history 
        : this.history.filter(item => item.type === currentFilter);
      
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="notify-empty">Henüz bildirim yok</div>';
        return;
      }
      
      listEl.innerHTML = filtered.map(item => `
        <div class="notify-history-item notify-type-${item.type}" role="listitem">
          <span class="notify-item-type" aria-hidden="true">
            ${item.type === 'success' ? '✓' : item.type === 'error' ? '✕' : item.type === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <div class="notify-item-content">
            <div class="notify-item-title">${this.escapeHtml(item.title)}</div>
            <div class="notify-item-message">${this.escapeHtml(item.message || '')}</div>
            <div class="notify-item-time">${this.formatTime(item.timestamp)}</div>
          </div>
        </div>
      `).join('');
    };
    
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        render();
      });
    });
    
    clearBtn.addEventListener('click', () => {
      this.clearHistory();
      render();
    });
    
    closeBtn.addEventListener('click', () => {
      panel.classList.remove('notify-panel-show');
      setTimeout(() => panel.remove(), 300);
    });
    
    panel.addEventListener('click', (e) => {
      if (e.target === panel) {
        closeBtn.click();
      }
    });
    
    render();
    return panel;
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Az önce';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} dk önce`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} sa önce`;
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  showHistoryPanel() {
    const existing = document.querySelector('.notify-history-panel');
    if (existing) {
      existing.classList.add('notify-panel-show');
      return;
    }
    
    const panel = this.createHistoryPanel();
    document.body.appendChild(panel);
    
    requestAnimationFrame(() => {
      panel.classList.add('notify-panel-show');
    });
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
  }

  setBrowserNotificationEnabled(enabled) {
    this.browserNotificationEnabled = !!enabled && this.notificationPermission === 'granted';
  }

  destroy() {
    this.dismissAll();
    if (this.toastContainer?.parentNode) {
      this.toastContainer.parentNode.removeChild(this.toastContainer);
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotifyServis;
} else if (typeof window !== 'undefined') {
  window.NotifyServis = NotifyServis;
}