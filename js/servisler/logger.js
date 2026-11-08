class LoggerServis {
  constructor() {
    this.logs = [];
    this.maxLogs = 200;
    this.storageKey = 'hafize_logs';
    this.panel = null;
    this.modal = null;
    this.currentFilter = 'all';
    this.init();
  }

  init() {
    this.loadLogs();
    this.captureConsoleErrors();
    this.createPanel();
    
    // Global logger servisi olarak kaydet
    if (typeof window !== 'undefined') {
      window.loggerServis = this;
    }
  }

  loadLogs() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      this.logs = [];
    }
  }

  saveLogs() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.logs));
    } catch (e) {
      console.warn('[Logger] Loglar kaydedilemedi:', e);
    }
  }

  addLog(level, message, context = null, stack = null) {
    const entry = {
      level,
      message,
      timestamp: Date.now(),
      context,
      stack
    };

    this.logs.unshift(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    this.saveLogs();
    this.updatePanelIfOpen();
  }

  error(message, context = null, stack = null) {
    this.addLog('error', message, context, stack);
  }

  warn(message, context = null) {
    this.addLog('warn', message, context);
  }

  warning(message, context = null) {
    this.addLog('warn', message, context);
  }

  info(message, context = null) {
    this.addLog('info', message, context);
  }

  debug(message, context = null) {
    this.addLog('debug', message, context);
  }

  getLogs(filter = 'all') {
    if (filter === 'all') {
      return [...this.logs];
    }
    return this.logs.filter(log => log.level === filter);
  }

  clearLogs() {
    this.logs = [];
    this.saveLogs();
    this.updatePanelIfOpen();
  }

  captureConsoleErrors() {
    window.addEventListener('error', (event) => {
      this.error(
        event.message || 'Bilinmeyen hata',
        { filename: event.filename, lineno: event.lineno, colno: event.colno },
        event.error?.stack || null
      );
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? reason.stack : null;
      this.error(
        `Unhandled Rejection: ${message}`,
        { type: 'unhandledrejection' },
        stack
      );
    });

    const originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
      originalConsoleError(...args);
      const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      this.error(message, { source: 'console.error' });
    };

    const originalConsoleWarn = console.warn.bind(console);
    console.warn = (...args) => {
      originalConsoleWarn(...args);
      const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      this.warn(message, { source: 'console.warn' });
    };
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  getLogs(filter = 'all') {
    if (filter === 'all') {
      return [...this.logs];
    }
    // Hem 'warn' hem 'warning' filtrelerini destekle
    const normalizedFilter = filter === 'warning' ? 'warn' : filter;
    return this.logs.filter(log => log.level === normalizedFilter);
  }

  createPanel() {
    if (document.querySelector('.logger-panel')) return;

    this.panel = document.createElement('div');
    this.panel.className = 'logger-panel';
    this.panel.innerHTML = `
      <div class="logger-panel-header">
        <h3>Hata Logları</h3>
        <div class="logger-panel-actions">
          <button class="logger-clear-btn" type="button" aria-label="Logları temizle">🗑</button>
          <button class="logger-close-panel" type="button" aria-label="Paneli kapat">×</button>
        </div>
      </div>
      <div class="logger-panel-filters" role="group" aria-label="Filtrele">
        <button class="logger-filter-btn active" data-filter="all" type="button">Tümü</button>
        <button class="logger-filter-btn" data-filter="error" type="button">Hata</button>
        <button class="logger-filter-btn" data-filter="warn" type="button">Uyarı</button>
        <button class="logger-filter-btn" data-filter="info" type="button">Bilgi</button>
        <button class="logger-filter-btn" data-filter="debug" type="button">Debug</button>
      </div>
      <div class="logger-panel-list" role="list" aria-label="Log listesi"></div>
    `;

    document.body.appendChild(this.panel);

    const listEl = this.panel.querySelector('.logger-panel-list');
    const filterBtns = this.panel.querySelectorAll('.logger-filter-btn');
    const clearBtn = this.panel.querySelector('.logger-clear-btn');
    const closeBtn = this.panel.querySelector('.logger-close-panel');

    const render = () => {
      const filtered = this.currentFilter === 'all'
        ? this.logs
        : this.logs.filter(log => log.level === this.currentFilter);

      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="logger-empty">Henüz log yok</div>';
        return;
      }

      listEl.innerHTML = filtered.map((log, index) => `
        <div class="logger-item logger-type-${log.level}" role="listitem" data-index="${this.logs.indexOf(log)}">
          <span class="logger-item-type" aria-hidden="true">
            ${log.level === 'error' ? '✕' : log.level === 'warn' ? '⚠' : log.level === 'info' ? 'ℹ' : '🔧'}
          </span>
          <div class="logger-item-content">
            <div class="logger-item-message">${this.escapeHtml(log.message)}</div>
            <div class="logger-item-time">${this.formatTime(log.timestamp)}</div>
          </div>
          <button class="logger-item-detail" type="button" aria-label="Detay" data-index="${this.logs.indexOf(log)}">▸</button>
        </div>
      `).join('');

      listEl.querySelectorAll('.logger-item-detail').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index, 10);
          this.showDetailModal(idx);
        });
      });

      listEl.querySelectorAll('.logger-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.index, 10);
          this.showDetailModal(idx);
        });
      });
    };

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        render();
      });
    });

    clearBtn.addEventListener('click', () => {
      this.clearLogs();
      render();
    });

    closeBtn.addEventListener('click', () => {
      this.hidePanel();
    });

    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) {
        this.hidePanel();
      }
    });

    this.render = render;
  }

  updatePanelIfOpen() {
    if (this.panel && this.panel.classList.contains('logger-panel-show')) {
      if (this.render) this.render();
    }
  }

  showPanel() {
    if (!this.panel) this.createPanel();
    this.panel.classList.add('logger-panel-show');
    if (this.render) this.render();
  }

  hidePanel() {
    if (this.panel) {
      this.panel.classList.remove('logger-panel-show');
    }
  }

  showDetailModal(index) {
    const log = this.logs[index];
    if (!log) return;

    if (this.modal) {
      this.modal.remove();
    }

    this.modal = document.createElement('div');
    this.modal.className = 'logger-modal';
    this.modal.innerHTML = `
      <div class="logger-modal-content">
        <div class="logger-modal-header">
          <h4>Log Detayı</h4>
          <button class="logger-modal-close" type="button" aria-label="Kapat">×</button>
        </div>
        <div class="logger-modal-body">
          <div class="log-detail-row">
            <strong>Seviye: <span class="log-type-${log.level}">${log.level.toUpperCase()}</span></strong>
          </div>
          <div class="log-detail-row">
            <strong>Zaman:</strong>
            <pre>${new Date(log.timestamp).toISOString()}</pre>
          </div>
          <div class="log-detail-row">
            <strong>Mesaj:</strong>
            <pre>${this.escapeHtml(log.message)}</pre>
          </div>
          ${log.context ? `
          <div class="log-detail-row">
            <strong>Bağlam:</strong>
            <pre>${this.escapeHtml(JSON.stringify(log.context, null, 2))}</pre>
          </div>
          ` : ''}
          ${log.stack ? `
          <div class="log-detail-row">
            <strong>Stack Trace:</strong>
            <pre>${this.escapeHtml(log.stack)}</pre>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    const closeBtn = this.modal.querySelector('.logger-modal-close');
    closeBtn.addEventListener('click', () => this.hideModal());

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.hideModal();
      }
    });
  }

  hideModal() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }

  destroy() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.hideModal();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LoggerServis;
} else if (typeof window !== 'undefined') {
  window.LoggerServis = LoggerServis;
}