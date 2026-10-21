// The live snapshot: Server-Sent Events first, a 5-second poll while the stream is down.
import { useState, useEffect, useRef, useCallback } from './react.js';

const POLL_MS = 5000;

export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState(null);
  const [conn, setConn] = useState('reconnecting');
  const [lastUpdate, setLastUpdate] = useState(null);
  const source = useRef(null);
  const poll = useRef(null);
  const [attempt, setAttempt] = useState(0);

  const accept = useCallback((text) => {
    let next;
    try { next = JSON.parse(text); } catch (e) { return false; }
    if (!next || !next.schemaVersion) return false;
    setSnapshot(next);
    setLastUpdate(Date.now());
    return true;
  }, []);

  useEffect(() => {
    let closed = false;
    function stopPoll() { clearInterval(poll.current); poll.current = null; }
    function fetchOnce() {
      fetch('/api/snapshot', { cache: 'no-store' }).then((r) => r.text()).then((text) => {
        if (closed) return;
        if (accept(text)) setConn((c) => (c === 'live' ? c : 'stale'));
      }, () => { if (!closed) setConn((c) => (c === 'live' ? c : 'offline')); });
    }
    function startPoll() { if (!poll.current) { fetchOnce(); poll.current = setInterval(fetchOnce, POLL_MS); } }
    const es = typeof EventSource === 'undefined' ? null : new EventSource('/api/events');
    source.current = es;
    if (!es) { startPoll(); return () => { closed = true; stopPoll(); }; }
    es.addEventListener('snapshot', (e) => { if (accept(e.data)) { setConn('live'); stopPoll(); } });
    es.onopen = () => { setConn('live'); stopPoll(); };
    // EventSource retries on its own; until it is back the snapshot is polled, so the board never freezes silently.
    es.onerror = () => { setConn((c) => (c === 'live' ? 'reconnecting' : c)); startPoll(); };
    return () => { closed = true; es.close(); stopPoll(); };
  }, [attempt, accept]);

  const reconnect = useCallback(() => { setConn('reconnecting'); setAttempt((n) => n + 1); }, []);
  return { snapshot, conn, lastUpdate, reconnect };
}
