/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-is-framework-independent',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        path: ['^apps/', '^packages/database/', '^packages/pasarguard/'],
      },
    },
    {
      name: 'contracts-are-infrastructure-independent',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: {
        path: ['^apps/', '^packages/database/', '^packages/pasarguard/'],
      },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['dist', 'coverage', 'graphify-out'] },
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
    },
  },
};
