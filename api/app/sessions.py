"""Per-customer conversation state and a simple rate limiter, both in memory and bounded.

Sessions are keyed by a random id the browser keeps for its tab. One customer's facts
and history are never visible to another. Idle sessions expire; the oldest are
evicted when the cap is reached.
"""

from __future__ import annotations

import re
import threading
import time
import uuid
from collections import OrderedDict, deque
from dataclasses import dataclass, field

from .facts import Facts

SESSION_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


@dataclass
class Session:
    id: str
    facts: Facts = field(default_factory=Facts)
    history: deque = field(default_factory=lambda: deque(maxlen=20))  # (who, text)
    last_seen: float = field(default_factory=time.monotonic)
    busy: bool = False


class SessionStore:
    def __init__(self, ttl_s: int, max_sessions: int):
        self.ttl_s, self.max_sessions = ttl_s, max_sessions
        self._sessions: OrderedDict[str, Session] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, session_id: str | None) -> Session:
        now = time.monotonic()
        with self._lock:
            self._expire(now)
            if session_id and SESSION_ID.match(session_id) and session_id in self._sessions:
                s = self._sessions[session_id]
                s.last_seen = now
                self._sessions.move_to_end(session_id)
                return s
            sid = session_id if session_id and SESSION_ID.match(session_id) else uuid.uuid4().hex
            s = Session(id=sid)
            self._sessions[sid] = s
            while len(self._sessions) > self.max_sessions:
                self._sessions.popitem(last=False)
            return s

    def _expire(self, now: float) -> None:
        while self._sessions:
            sid, s = next(iter(self._sessions.items()))
            if now - s.last_seen <= self.ttl_s:
                break
            self._sessions.pop(sid)

    def __len__(self) -> int:
        return len(self._sessions)


class RateLimiter:
    """At most `per_minute` requests per key in any rolling 60 seconds."""

    def __init__(self, per_minute: int, max_keys: int = 20000):
        self.per_minute, self.max_keys = per_minute, max_keys
        self._hits: OrderedDict[str, deque] = OrderedDict()
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                q = deque()
                self._hits[key] = q
            self._hits.move_to_end(key)
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            while len(self._hits) > self.max_keys:
                self._hits.popitem(last=False)
            return True
