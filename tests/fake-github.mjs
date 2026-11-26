// A stand-in for the GitHub and Turnstile APIs, for testing the Worker without the network.
export function fakeGitHub({ human = true } = {}) {
  const state = { refs: { 'heads/main': 'c0' }, blobs: {}, trees: {}, commits: { c0: { tree: 't0' } }, release: null, assets: {}, pulls: [], labels: {}, calls: [] };
  let n = 0;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    state.calls.push(`${method} ${u.pathname}`);
    if (u.host === 'challenges.cloudflare.com') return json({ success: human });
    if (u.host === 'uploads.github.com') {
      const name = u.searchParams.get('name');
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      if (String(bytes.length) !== init.headers['Content-Length']) return json({ message: 'length mismatch' }, 400);
      state.assets[name] = bytes;
      return json({ name }, 201);
    }
    const p = u.pathname.replace('/repos/theDutchmanJames/SlotForgeLibrary', '');
    const body = init.body ? JSON.parse(init.body) : null;
    let m;
    if (method === 'GET' && (m = p.match(/^\/git\/ref\/(.+)$/))) return state.refs[m[1]] ? json({ object: { sha: state.refs[m[1]] } }) : json({}, 404);
    if (method === 'GET' && (m = p.match(/^\/git\/commits\/(.+)$/))) return json({ tree: { sha: state.commits[m[1]].tree } });
    if (method === 'POST' && p === '/git/blobs') { const sha = `b${++n}`; state.blobs[sha] = body; return json({ sha }, 201); }
    if (method === 'POST' && p === '/git/trees') { const sha = `t${++n}`; state.trees[sha] = body; return json({ sha }, 201); }
    if (method === 'POST' && p === '/git/commits') { const sha = `c${++n}`; state.commits[sha] = { tree: body.tree, message: body.message }; return json({ sha }, 201); }
    if (method === 'POST' && p === '/git/refs') { state.refs[body.ref.replace('refs/', '')] = body.sha; return json({}, 201); }
    if (method === 'GET' && (m = p.match(/^\/contents\/(.+)$/))) {
      const ref = u.searchParams.get('ref');
      const tree = state.trees[state.commits[state.refs['heads/' + ref]].tree];
      const entry = tree.tree.find(e => e.path === m[1]);
      const blob = state.blobs[entry.sha];
      return json({ content: blob.encoding === 'base64' ? blob.content : btoa(unescape(encodeURIComponent(blob.content))) });
    }
    if (method === 'GET' && p === '/releases') return json(state.release ? [{ ...state.release, assets: Object.keys(state.assets).map(name => ({ name })) }] : []);
    if (method === 'POST' && p === '/releases') { state.release = { id: 1, draft: body.draft, name: body.name, upload_url: 'https://uploads.github.com/repos/theDutchmanJames/SlotForgeLibrary/releases/1/assets{?name,label}' }; return json(state.release, 201); }
    if (method === 'POST' && p === '/pulls') { const pr = { number: 100 + state.pulls.length, html_url: `https://github.com/pr/${100 + state.pulls.length}`, ...body }; state.pulls.push(pr); return json(pr, 201); }
    if (method === 'POST' && (m = p.match(/^\/issues\/(\d+)\/labels$/))) { state.labels[m[1]] = body.labels; return json([], 200); }
    return json({ message: `unexpected ${method} ${p}` }, 500);
  };
  return { state, fetch };
}
