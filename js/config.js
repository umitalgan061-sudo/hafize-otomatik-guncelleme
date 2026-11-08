const Config = {
  GITHUB_TOKEN: '',
  REPO_OWNER: 'umitalgan061-sudo',
  REPO_NAME: 'hafize-otomatik-guncelleme',
  FIREBASE_PROJECT_ID: '',
  FIREBASE_API_KEY: '',
  YENILEME_ARALIGI_MS: 30 * 60 * 1000,
  githubApiBase: 'https://api.github.com'
};

if (typeof window !== 'undefined') {
  window.Config = Config;
}