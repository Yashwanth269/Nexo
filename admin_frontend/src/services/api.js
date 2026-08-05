/**
 * Nexo Zone Admin Panel API Service
 * Enforces Zone-Filtered API calls (`zone=Kolar|London|New York|...`) with JWT auth
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('nexo_admin_token') || null;
    this.zone = localStorage.getItem('nexo_admin_zone') || 'Kolar';
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('nexo_admin_token', token);
    } else {
      localStorage.removeItem('nexo_admin_token');
    }
  }

  setZone(zone) {
    this.zone = zone;
    localStorage.setItem('nexo_admin_zone', zone);
    window.dispatchEvent(new CustomEvent('nexo_zone_changed', { detail: zone }));
  }

  getZone() {
    return this.zone;
  }

  async request(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.status === 401) {
        this.setToken(null);
        window.dispatchEvent(new CustomEvent('nexo_auth_expired'));
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || `Request failed with status ${response.status}`);
      }
      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err.message);
      throw err;
    }
  }

  // Dashboard & Metrics (Zone Aware)
  getOverviewStats(zone = this.zone) { 
    return this.request(`/admin/overview-stats?zone=${encodeURIComponent(zone)}`); 
  }
  
  getBookingsSummary(zone = this.zone, page = 1, limit = 10, category = '', status = 'ALL', search = '') {
    return this.request(`/admin/bookings-summary?zone=${encodeURIComponent(zone)}&page=${page}&limit=${limit}&category=${encodeURIComponent(category)}&status=${status}&search=${encodeURIComponent(search)}`);
  }

  getCustomersSummary(zone = this.zone, page = 1, limit = 10) {
    return this.request(`/admin/customers-summary?zone=${encodeURIComponent(zone)}&page=${page}&limit=${limit}`);
  }

  getAiSummary(zone = this.zone) {
    return this.request(`/admin/ai-summary?zone=${encodeURIComponent(zone)}`);
  }

  getAnalyticsSummary(zone = this.zone) {
    return this.request(`/admin/analytics-summary?zone=${encodeURIComponent(zone)}`);
  }

  getMarketplaceSummary(zone = this.zone) {
    return this.request(`/admin/marketplace-summary?zone=${encodeURIComponent(zone)}`);
  }

  getSupportSummary(zone = this.zone) {
    return this.request(`/admin/support-summary?zone=${encodeURIComponent(zone)}`);
  }

  getMediaSummary(zone = this.zone) {
    return this.request(`/admin/media-summary?zone=${encodeURIComponent(zone)}`);
  }

  getCommunicationsSummary(zone = this.zone) {
    return this.request(`/admin/communications-summary?zone=${encodeURIComponent(zone)}`);
  }

  composeCommunication(data, zone = this.zone) {
    return this.request(`/admin/communications/compose?zone=${encodeURIComponent(zone)}`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  getRolesSummary(zone = this.zone) {
    return this.request(`/admin/roles-summary?zone=${encodeURIComponent(zone)}`);
  }

  toggleMfa(adminId) {
    return this.request(`/admin/roles/toggle-mfa`, {
      method: 'POST',
      body: JSON.stringify({ adminId })
    });
  }

  getTeamsSummary() {
    return this.request(`/admin/teams-summary`);
  }

  getTrustSummary() {
    return this.request(`/admin/trust-summary`);
  }

  getHeatmapSnapshots(hours = 24) { return this.request(`/admin/heatmap?hours=${hours}`); }
  getRealtimeMetrics() { return this.request('/metrics/realtime'); }
  getModelMaturity() { return this.request('/admin/model-maturity'); }
  getLiveMap(zone = this.zone) { return this.request(`/admin/live-map?zone=${encodeURIComponent(zone)}`); }

  // Bookings & Dispatch
  getJobs(status = 'ALL', limit = 50) { return this.request(`/jobs?status=${status}&limit=${limit}`); }
  getDispatchQueue() { return this.request('/admin_dispatch/queue'); }
  cancelJob(jobId, reason) { return this.request('/job-lifecycle/cancel', { method: 'POST', body: JSON.stringify({ jobId, reason }) }); }

  // Workers & CRM
  getWorkers() { return this.request('/workers'); }
  getWorkerReliability() { return this.request('/admin/reliability'); }
  getShadowBans() { return this.request('/admin/shadow-ban'); }
  setShadowBan(workerId, level, reason) { return this.request(`/admin/shadow-ban/${workerId}`, { method: 'POST', body: JSON.stringify({ level, reason }) }); }
  deescalateShadowBan(workerId) { return this.request(`/admin/shadow-ban/${workerId}/deescalate`, { method: 'POST' }); }

  // Marketplace & 3-Tier Hierarchy
  getCategories() { return this.request('/marketplace/categories'); }
  getMarketplaceJobs() { return this.request('/marketplace/jobs'); }
  getTrending() { return this.request('/market/trending?lat=13.0827&lng=80.2707'); }

  // Teams & Emergency
  getEmergencyReports() { return this.request('/admin/emergency'); }
  getTeamJobs() { return this.request('/team-jobs/active'); }

  // CMS & Banners
  getCmsBanners() { return this.request('/admin_cms/banners'); }
  createCmsBanner(bannerData) { return this.request('/admin_cms/banners', { method: 'POST', body: JSON.stringify(bannerData) }); }

  // Auth
  login(phoneNumber, otp = '123456', zone = 'Kolar') { 
    this.setZone(zone);
    return this.request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phoneNumber, otp, role: 'ZONE_ADMIN', zone }) }); 
  }
}

export const api = new ApiService();
