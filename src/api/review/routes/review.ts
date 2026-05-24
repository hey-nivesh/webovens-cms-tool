export default {
  routes: [
    {
      method: 'POST',
      path: '/review/analyze',
      handler: 'review.analyzeRepo',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/review/chat',
      handler: 'review.chat',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/review/apply-fixes',
      handler: 'review.applyFixes',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/reviews',
      handler: 'review.find',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/reviews/:id',
      handler: 'review.findOne',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
