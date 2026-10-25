// Pure: D1 rows -> RTDB-shaped root. No token_hash / uid ever emitted.
// seats:[{username,claimed_at,blur_count}] answers:[{username,qid,value}] flags:[{username,item_id}]
// submitted:[{username,part,at}] control:[{part,start_at,end_at}]
export function buildTree({ seats = [], answers = [], flags = [], submitted = [], control = [] } = {}) {
  const root = {};
  const ctl = {};
  for (const c of control) ctl[c.part] = { startAt: c.start_at, endAt: c.end_at };
  if (Object.keys(ctl).length) root._control = ctl;

  const user = (u) => (root[u] ||= {});
  for (const s of seats) {
    const u = user(s.username);
    u.claimed = true;
    u.claimedAt = s.claimed_at;
    u.blurCount = s.blur_count;
  }
  for (const a of answers) (user(a.username).answers ||= {})[a.qid] = a.value;
  for (const f of flags) (user(f.username).flags ||= {})[f.item_id] = true;
  for (const s of submitted) (user(s.username).submitted ||= {})[s.part] = s.at;
  return root;
}
