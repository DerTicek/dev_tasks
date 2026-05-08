const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3030);

const fixtures = {
  'google.com': {
    name: 'Google',
    employees: 150000,
    employeesRange: '100K+',
    sector: 'Technology',
    industryGroup: 'Software & Services',
    industry: 'Tech',
    tags: ['technology', 'search', 'cloud']
  },
  'stripe.com': {
    name: 'Stripe',
    employees: 8000,
    employeesRange: '5K-10K',
    sector: 'Technology',
    industryGroup: 'Software & Services',
    industry: 'Tech',
    tags: ['payments', 'fintech', 'developer tools']
  },
  'acme.io': {
    name: 'Acme',
    employees: 75,
    employeesRange: '51-250',
    sector: 'Technology',
    industryGroup: 'Software & Services',
    industry: 'Tech',
    tags: ['saas', 'b2b']
  },
  'midmarket.io': {
    name: 'MidMarket',
    employees: 200,
    employeesRange: '51-250',
    sector: 'Consumer Discretionary',
    industryGroup: 'Retailing',
    industry: 'Retail',
    tags: ['retail', 'commerce']
  },
  'localbakery.com': {
    name: 'Local Bakery',
    employees: 12,
    employeesRange: '11-50',
    sector: 'Consumer Staples',
    industryGroup: 'Food & Staples Retailing',
    industry: 'Food',
    tags: ['food', 'local business']
  },
  'megabank.com': {
    name: 'MegaBank',
    employees: 90000,
    employeesRange: '50K-100K',
    sector: 'Financials',
    industryGroup: 'Banks',
    industry: 'Finance',
    tags: ['banking', 'finance']
  }
};

function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function fallback(domain) {
  const h = hash(domain);
  const sizes = [
    { employees: 25, employeesRange: '11-50' },
    { employees: 200, employeesRange: '51-250' },
    { employees: 2500, employeesRange: '1K-5K' }
  ];
  const industries = [
    { sector: 'Technology', industryGroup: 'Software & Services', industry: 'Tech', tags: ['software'] },
    { sector: 'Financials', industryGroup: 'Financial Services', industry: 'Finance', tags: ['finance'] },
    { sector: 'Health Care', industryGroup: 'Health Care Equipment & Services', industry: 'Healthcare', tags: ['healthcare'] },
    { sector: 'Consumer Discretionary', industryGroup: 'Retailing', industry: 'Retail', tags: ['retail'] },
    { sector: 'Other', industryGroup: 'Other', industry: 'Other', tags: ['other'] }
  ];

  return {
    name: domain.split('.')[0],
    ...sizes[h % sizes.length],
    ...industries[h % industries.length]
  };
}

function clearbitPayload(domain, data, source) {
  return {
    id: `mock-${domain.replace(/[^a-z0-9]/gi, '-')}`,
    name: data.name,
    domain,
    mock: true,
    mockSource: source,
    category: {
      sector: data.sector,
      industryGroup: data.industryGroup,
      industry: data.industry
    },
    metrics: {
      employees: data.employees,
      employeesRange: data.employeesRange
    },
    tags: data.tags,
    techCategories: data.industry === 'Tech' ? ['Analytics', 'Cloud Computing'] : [],
    indexedAt: new Date().toISOString()
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method !== 'GET' || url.pathname !== '/v2/companies/find') {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const domain = String(url.searchParams.get('domain') || '').trim().toLowerCase();
  if (!domain) {
    sendJson(res, 400, { found: false, error: 'Missing required query parameter: domain' });
    return;
  }

  const exact = fixtures[domain];
  const data = exact || fallback(domain);
  sendJson(res, 200, clearbitPayload(domain, data, exact ? 'mock_api_fixture' : 'mock_api_simulated'));
});

server.listen(PORT, () => {
  console.log(`Mock Clearbit API listening on http://0.0.0.0:${PORT}`);
});
