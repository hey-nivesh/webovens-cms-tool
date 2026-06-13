export default {
  routes: [
    {
      method: 'POST',
      path: '/github/connect',
      handler: 'github-connection.exchangeCode',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/github/disconnect',
      handler: 'github-connection.disconnect',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/github/repos',
      handler: 'repos.listRepos',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/github/tree',
      handler: 'repos.getRepoTree',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/github/file',
      handler: 'repos.getFileContent',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/github/profile-analysis',
      handler: 'repos.analyzeProfile',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
