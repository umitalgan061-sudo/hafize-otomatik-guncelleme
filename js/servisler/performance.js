class PerformanceServis {
  constructor(config = {}) {
    this.config = config;
    this.metrics = {
      lcp: null,
      fid: null,
      cls: null,
      fcp: null,
      ttfb: null
    };
    this.observers = [];
    this.isInitialized = false;
    this.storageKey = 'hafize_performance_metrics';
    this.thresholds = {
      lcp: { good: 2500, poor: 4000 },
      fid: { good: 100, poor: 300 },
      cls: { good: 0.1, poor: 0.25 },
      fcp: { good: 1800, poor: 3000 },
      ttfb: { good: 800, poor: 1800 }
    };
  }

  init() {
    if (this.isInitialized) return;
    
    if (document.readyState === 'complete') {
      this.startObserving();
    } else {
      window.addEventListener('load', () => this.startObserving(), { once: true });
    }
    
    this.loadFromStorage();
    this.isInitialized = true;
    console.log('[PerformanceServis] Başlatıldı');
    
    // Global performance servisi olarak kaydet
    if (typeof window !== 'undefined') {
      window.performanceServis = this;
    }
  }

  startObserving() {
    this.observeLCP();
    this.observeFID();
    this.observeCLS();
    this.observeFCP();
    this.observeTTFB();
  }

  observeLCP() {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          this.metrics.lcp = {
            value: Math.round(lastEntry.startTime),
            rating: this.getRating('lcp', lastEntry.startTime),
            timestamp: Date.now(),
            url: lastEntry.url || window.location.href
          };
          this.saveToStorage();
          this.reportToDashboard();
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.warn('[PerformanceServis] LCP observer hatası:', e);
    }
  }

  observeFID() {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const firstInput = entries[0];
        if (firstInput) {
          const delay = firstInput.processingStart - firstInput.startTime;
          this.metrics.fid = {
            value: Math.round(delay),
            rating: this.getRating('fid', delay),
            timestamp: Date.now(),
            url: window.location.href
          };
          this.saveToStorage();
          this.reportToDashboard();
        }
      });
      observer.observe({ type: 'first-input', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.warn('[PerformanceServis] FID observer hatası:', e);
    }
  }

  observeCLS() {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      let clsValue = 0;
      let sessionEntries = [];
      
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            sessionEntries.push(entry);
          }
        }
        
        this.metrics.cls = {
          value: Math.round(clsValue * 1000) / 1000,
          rating: this.getRating('cls', clsValue),
          timestamp: Date.now(),
          url: window.location.href,
          entries: sessionEntries.length
        };
        this.saveToStorage();
        this.reportToDashboard();
      });
      observer.observe({ type: 'layout-shift', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.warn('[PerformanceServis] CLS observer hatası:', e);
    }
  }

  observeFCP() {
    if (!('PerformanceObserver' in window)) return;
    
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const fcpEntry = entries.find(e => e.name === 'first-contentful-paint');
        if (fcpEntry) {
          this.metrics.fcp = {
            value: Math.round(fcpEntry.startTime),
            rating: this.getRating('fcp', fcpEntry.startTime),
            timestamp: Date.now(),
            url: window.location.href
          };
          this.saveToStorage();
          this.reportToDashboard();
        }
      });
      observer.observe({ type: 'paint', buffered: true });
      this.observers.push(observer);
    } catch (e) {
      console.warn('[PerformanceServis] FCP observer hatası:', e);
    }
  }

  observeTTFB() {
    if (!('performance' in window) || !performance.timing) return;
    
    try {
      const navigationEntries = performance.getEntriesByType('navigation');
      if (navigationEntries.length > 0) {
        const nav = navigationEntries[0];
        const ttfb = nav.responseStart - nav.requestStart;
        this.metrics.ttfb = {
          value: Math.round(ttfb),
          rating: this.getRating('ttfb', ttfb),
          timestamp: Date.now(),
          url: window.location.href
        };
        this.saveToStorage();
        this.reportToDashboard();
      }
    } catch (e) {
      console.warn('[PerformanceServis] TTFB ölçüm hatası:', e);
    }
  }

  getRating(metricName, value) {
    const thresholds = this.thresholds[metricName];
    if (!thresholds) return 'unknown';
    
    if (value <= thresholds.good) return 'good';
    if (value <= thresholds.poor) return 'needs-improvement';
    return 'poor';
  }

  getRatingLabel(rating) {
    const labels = {
      good: 'İyi',
      'needs-improvement': 'İyileştirme Gerekli',
      poor: 'Kötü',
      unknown: 'Bilinmiyor'
    };
    return labels[rating] || labels.unknown;
  }

  getRatingClass(rating) {
    const classes = {
      good: 'perf-good',
      'needs-improvement': 'perf-needs-improvement',
      poor: 'perf-poor',
      unknown: ''
    };
    return classes[rating] || '';
  }

  saveToStorage() {
    try {
      const data = {
        metrics: this.metrics,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('[PerformanceServis] localStorage yazma hatası:', e);
    }
  }

  loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.metrics) {
          this.metrics = { ...this.metrics, ...data.metrics };
        }
      }
    } catch (e) {
      console.warn('[PerformanceServis] localStorage okuma hatası:', e);
    }
  }

  getMetrics() {
    return {
      lcp: this.metrics.lcp ? { ...this.metrics.lcp, label: 'LCP', unit: 'ms' } : null,
      fid: this.metrics.fid ? { ...this.metrics.fid, label: 'FID', unit: 'ms' } : null,
      cls: this.metrics.cls ? { ...this.metrics.cls, label: 'CLS', unit: '' } : null,
      fcp: this.metrics.fcp ? { ...this.metrics.fcp, label: 'FCP', unit: 'ms' } : null,
      ttfb: this.metrics.ttfb ? { ...this.metrics.ttfb, label: 'TTFB', unit: 'ms' } : null,
      timestamp: Date.now()
    };
  }

  reportToDashboard() {
    const metrics = this.getMetrics();
    try {
      window.dispatchEvent(new CustomEvent('performance-update', {
        detail: metrics
      }));
    } catch (e) {
      console.warn('[PerformanceServis] Dashboard raporlama hatası:', e);
    }
  }

  showPanel() {
    if (typeof window.LoggerServis !== 'undefined' && window.loggerServis) {
      window.loggerServis.info('PerformanceServis', 'Performans paneli açma isteği alındı');
    }
    const panel = document.querySelector('.performance-panel');
    if (panel) {
      panel.classList.add('performance-panel-show');
    } else {
      const event = new CustomEvent('performance-show-panel');
      window.dispatchEvent(event);
    }
  }

  destroy() {
    this.observers.forEach(observer => {
      try {
        observer.disconnect();
      } catch (e) {
        console.warn('[PerformanceServis] Observer disconnect hatası:', e);
      }
    });
    this.observers = [];
    this.isInitialized = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceServis;
} else if (typeof window !== 'undefined') {
  window.PerformanceServis = PerformanceServis;
}