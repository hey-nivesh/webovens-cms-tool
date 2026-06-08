export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/github',
      handler: 'github-connection.githubAuth',
      config: {
        auth: false, // public — no JWT required
        policies: [],
        middlewares: [],
      },
    },
  ],
};
