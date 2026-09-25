// Minimal robots.txt evaluator (RFC 9309): picks the most specific
// user-agent group, then the longest matching Allow/Disallow rule.

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  return groups;
}

function ruleMatches(rulePath, path) {
  if (rulePath === '') return false;
  const re = new RegExp('^' + rulePath.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path);
}

// Returns { allowed, rule, agent } for a path.
export function isAllowed(groups, path, userAgent) {
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return {
    allowed: best ? best.allow : true,
    rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : '(no matching rule)',
    agent: specific.length ? specific[0].agents.join(',') : '*',
  };
}
