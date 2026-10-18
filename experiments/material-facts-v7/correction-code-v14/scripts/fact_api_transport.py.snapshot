"""One DeepSeek POST per case, with retries restricted to connection setup.

The optional loopback destination supports an externally managed SSH forward.
TLS SNI, certificate verification, HTTP Host and request path remain official.
No credentials, request bodies, response bodies or exception strings are logged.
"""

from __future__ import annotations

import errno
import hashlib
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
from typing import Callable


OFFICIAL_HOST = "api.deepseek.com"
OFFICIAL_PORT = 443
OFFICIAL_PATH = "/chat/completions"
CONNECT_TIMEOUT_SECONDS = 10
RESPONSE_TIMEOUT_SECONDS = 120
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_CONNECT_ATTEMPTS = 3
CONNECT_BACKOFF_SECONDS = (0.5, 1.0)


class TransportError(RuntimeError):
    """A failure whose safe_receipt can be persisted without sanitizing text."""

    def __init__(self, safe_receipt: dict):
        self.safe_receipt = dict(safe_receipt)
        super().__init__("DeepSeek transport failure: " + safe_receipt["error_code"])


class _OfficialHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *, connect_host, connect_port, timeout, context):
        super().__init__(OFFICIAL_HOST, OFFICIAL_PORT, timeout=timeout, context=context)
        self._connect_address = (connect_host, connect_port)
        # A lost socket must never implicitly open another connection mid-POST.
        self.auto_open = 0

    def connect(self):
        raw = socket.create_connection(self._connect_address, timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=OFFICIAL_HOST)
        except BaseException:
            raw.close()
            self.sock = None
            raise


def _transient_connection_error(exc):
    if isinstance(exc, ssl.SSLCertVerificationError):
        return False
    if isinstance(exc, (ssl.SSLEOFError, TimeoutError, ConnectionResetError, ConnectionAbortedError)):
        return True
    if isinstance(exc, socket.gaierror):
        return exc.errno == socket.EAI_AGAIN
    return isinstance(exc, OSError) and exc.errno in {
        errno.EAGAIN, errno.EINTR, errno.ECONNREFUSED, errno.ECONNRESET,
        errno.ECONNABORTED, errno.ETIMEDOUT, errno.ENETUNREACH, errno.EHOSTUNREACH,
    }


def _exception_fields(exc):
    fields = {"error_type": type(exc).__name__}
    value = getattr(exc, "errno", None)
    if isinstance(value, int) and not isinstance(value, bool):
        fields["errno"] = value
    reason = getattr(exc, "reason", None)
    if isinstance(exc, ssl.SSLError) and isinstance(reason, str) and re.fullmatch(r"[A-Z0-9_]{1,80}", reason):
        fields["ssl_reason"] = reason
    return fields


def _close(connection):
    if connection is not None:
        try:
            connection.close()
        except Exception:
            # Closing a failed connection must not hide its original receipt.
            pass


class DeepSeekTransport:
    """A fresh, verified connection for each case and one explicit POST.

    post(payload_bytes, authorization, case_id) returns (JSON object, metadata).
    authorization is the complete Authorization header value. The emit callback
    receives only structured transport events. Test doubles can be supplied with
    connection_factory(**kwargs), sleep(seconds), and clock().
    """

    def __init__(
        self,
        emit: Callable[[dict], None],
        connect_host=OFFICIAL_HOST,
        connect_port=OFFICIAL_PORT,
        *,
        connection_factory=None,
        sleep=time.sleep,
        clock=time.perf_counter,
    ):
        if not callable(emit):
            raise ValueError("An event callback is required")
        if not isinstance(connect_port, int) or isinstance(connect_port, bool) or not 1 <= connect_port <= 65535:
            raise ValueError("Invalid connection port")
        if connect_host == OFFICIAL_HOST:
            if connect_port != OFFICIAL_PORT:
                raise ValueError("Official endpoint requires port 443")
            route = "official"
        else:
            try:
                allowed = ipaddress.ip_address(connect_host).is_loopback
            except (ValueError, TypeError):
                allowed = False
            if not allowed:
                raise ValueError("Only the official endpoint or a loopback forward is allowed")
            route = "loopback_forward"
        self.connect_host = connect_host
        self.connect_port = connect_port
        self.route = route
        self._emit = emit
        self._factory = connection_factory or _OfficialHTTPSConnection
        self._sleep = sleep
        self._clock = clock

    def post(self, payload_bytes, authorization, case_id):
        if not isinstance(payload_bytes, bytes) or not payload_bytes:
            raise ValueError("A nonempty bytes payload is required")
        if not isinstance(authorization, str) or not authorization or "\r" in authorization or "\n" in authorization:
            raise ValueError("Invalid authorization header")
        if not isinstance(case_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", case_id):
            raise ValueError("Invalid case identifier")

        state = {
            "transport_route": self.route,
            "connect_attempts": 0,
            "submission_started": False,
            "request_body_sent": False,
            "post_attempts": 0,
        }
        connection = None
        response = None
        started = self._clock()

        def event(name, **fields):
            self._emit({"type": "transport", "event": name, "id": case_id, **state, **fields})

        def fail(stage, code, exc=None, **fields):
            receipt = {
                "stage": stage,
                "error_code": code,
                "retryable": False,
                **state,
                **(_exception_fields(exc) if exc is not None else {}),
                **fields,
            }
            event("error", **receipt)
            raise TransportError(receipt) from None

        try:
            for attempt in range(1, MAX_CONNECT_ATTEMPTS + 1):
                state["connect_attempts"] = attempt
                attempt_started = self._clock()
                event("transport_attempt", stage="connect", request_sha256=hashlib.sha256(payload_bytes).hexdigest())
                try:
                    context = ssl.create_default_context()
                    context.set_alpn_protocols(["http/1.1"])
                    connection = self._factory(
                        connect_host=self.connect_host,
                        connect_port=self.connect_port,
                        timeout=CONNECT_TIMEOUT_SECONDS,
                        context=context,
                    )
                    connection.auto_open = 0
                    connection.set_debuglevel(0)
                    connection.connect()
                except Exception as exc:
                    _close(connection)
                    connection = None
                    retryable = _transient_connection_error(exc)
                    event(
                        "connect",
                        stage="connect",
                        completed=False,
                        elapsed_seconds=self._clock() - attempt_started,
                        retryable=retryable,
                        **_exception_fields(exc),
                    )
                    if retryable and attempt < MAX_CONNECT_ATTEMPTS:
                        self._sleep(CONNECT_BACKOFF_SECONDS[attempt - 1])
                        continue
                    fail("connect", "certificate_verification_failed" if isinstance(exc, ssl.SSLCertVerificationError) else "connect_failed", exc)
                event(
                    "connect",
                    stage="connect",
                    completed=True,
                    elapsed_seconds=self._clock() - attempt_started,
                    certificate_verified=True,
                )
                break

            # Only the already verified socket may carry this one HTTP request.
            try:
                connection.sock.settimeout(RESPONSE_TIMEOUT_SECONDS)
            except Exception as exc:
                fail("connect", "connected_socket_unavailable", exc)
            state["submission_started"] = True
            state["post_attempts"] = 1
            event("send_started", stage="send")
            try:
                connection.request(
                    "POST",
                    OFFICIAL_PATH,
                    body=payload_bytes,
                    headers={
                        "Host": OFFICIAL_HOST,
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "Authorization": authorization,
                        "Connection": "close",
                    },
                )
            except Exception as exc:
                fail("send", "send_failed", exc)
            state["request_body_sent"] = True
            event("body_sent", stage="send")

            try:
                response = connection.getresponse()
                status = response.status
                if not isinstance(status, int) or isinstance(status, bool) or not 100 <= status <= 599:
                    fail("read", "invalid_http_status")
                state["http_status"] = status
                metadata = dict(state)
                for header, field in [("x-request-id", "server_request_id"), ("request-id", "request_id")]:
                    value = response.getheader(header)
                    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:/-]{1,200}", value):
                        metadata[field] = value
                event("http_response", stage="read", **metadata)
                # No Location handling exists: redirects cannot receive credentials.
                if not 200 <= status < 300:
                    fail("read", "http_error", http_status=status)
                length = response.getheader("Content-Length")
                declared_length = None
                if length is not None:
                    if not isinstance(length, str) or not re.fullmatch(r"[0-9]+", length.strip()):
                        fail("read", "invalid_content_length")
                    declared_length = int(length.strip())
                    if declared_length > MAX_RESPONSE_BYTES:
                        fail("read", "response_too_large", response_limit_bytes=MAX_RESPONSE_BYTES)
                body = response.read(MAX_RESPONSE_BYTES + 1)
                if not isinstance(body, bytes):
                    fail("read", "invalid_response_body")
                if len(body) > MAX_RESPONSE_BYTES:
                    fail("read", "response_too_large", response_limit_bytes=MAX_RESPONSE_BYTES)
                if declared_length is not None and len(body) != declared_length:
                    fail("read", "incomplete_response_body")
            except TransportError:
                raise
            except Exception as exc:
                fail("read", "read_failed", exc)

            try:
                value = json.loads(body)
            except (ValueError, UnicodeError, RecursionError) as exc:
                fail("decode", "invalid_json", exc)
            if not isinstance(value, dict):
                fail("decode", "invalid_json_object")
            metadata.update({"response_bytes": len(body), "transport_elapsed_seconds": self._clock() - started})
            return value, metadata
        finally:
            if response is not None:
                _close(response)
            _close(connection)
