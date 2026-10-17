"""Deterministic transport-boundary tests; no network, credentials or API fees."""

import errno
import http.client
import json
import ssl
import unittest
from unittest import mock

from fact_api_transport import DeepSeekTransport, MAX_RESPONSE_BYTES, TransportError, _OfficialHTTPSConnection


SECRET = "Bearer test-secret-must-not-enter-receipts"
PAYLOAD = b'{"messages":[{"content":"test payload"}]}'


class FakeSocket:
    def __init__(self):
        self.timeouts = []

    def settimeout(self, timeout):
        self.timeouts.append(timeout)


class FakeResponse:
    def __init__(self, *, status=200, body=b'{"choices":[]}', headers=None, read_error=None):
        self.status = status
        self.body = body
        self.headers = headers or {}
        self.read_error = read_error
        self.read_limits = []
        self.closed = False

    def getheader(self, name):
        return self.headers.get(name)

    def read(self, limit):
        self.read_limits.append(limit)
        if self.read_error:
            raise self.read_error
        return self.body[:limit]

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, *, connect_error=None, send_error=None, response_error=None, response=None):
        self.connect_error = connect_error
        self.send_error = send_error
        self.response_error = response_error
        self.response = response or FakeResponse()
        self.sock = FakeSocket()
        self.connect_calls = 0
        self.posts = []
        self.closed = False
        self.auto_open = 1
        self.debuglevel = None

    def set_debuglevel(self, level):
        self.debuglevel = level

    def connect(self):
        self.connect_calls += 1
        if self.connect_error:
            raise self.connect_error

    def request(self, method, path, *, body, headers):
        if self.auto_open != 0:
            raise AssertionError("Implicit reconnect was not disabled")
        self.posts.append((method, path, body, headers))
        if self.send_error:
            raise self.send_error

    def getresponse(self):
        if self.response_error:
            raise self.response_error
        return self.response

    def close(self):
        self.closed = True


class TransportTests(unittest.TestCase):
    def make(self, connections, **kwargs):
        events, sleeps, factory_args = [], [], []
        pool = iter(connections)

        def factory(**params):
            factory_args.append(params)
            return next(pool)

        transport = DeepSeekTransport(events.append, connection_factory=factory, sleep=sleeps.append, **kwargs)
        return transport, events, sleeps, factory_args

    def assert_private(self, events, error=None):
        receipt = json.dumps({"events": events, "error": error.safe_receipt if error else None})
        self.assertNotIn(SECRET, receipt)
        self.assertNotIn("test payload", receipt)
        self.assertNotIn("SENSITIVE_EXCEPTION_TEXT", receipt)

    def test_handshake_retries_then_one_post(self):
        connections = [
            FakeConnection(connect_error=ssl.SSLEOFError(8, "SENSITIVE_EXCEPTION_TEXT")),
            FakeConnection(connect_error=ConnectionResetError(errno.ECONNRESET, "SENSITIVE_EXCEPTION_TEXT")),
            FakeConnection(response=FakeResponse(headers={"x-request-id": "request-123"})),
        ]
        transport, events, sleeps, factory_args = self.make(connections)
        value, metadata = transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(value, {"choices": []})
        self.assertEqual(sleeps, [0.5, 1.0])
        self.assertEqual([len(c.posts) for c in connections], [0, 0, 1])
        self.assertEqual(metadata["connect_attempts"], 3)
        self.assertEqual(metadata["post_attempts"], 1)
        self.assertTrue(metadata["request_body_sent"])
        self.assertEqual(metadata["server_request_id"], "request-123")
        self.assertTrue(all(c.closed for c in connections))
        self.assertTrue(all(p["context"].check_hostname and p["context"].verify_mode == ssl.CERT_REQUIRED for p in factory_args))
        self.assertTrue(all(p["timeout"] == 10 for p in factory_args))
        final = connections[-1]
        self.assertEqual(final.sock.timeouts, [120])
        self.assertEqual(final.posts[0][:3], ("POST", "/chat/completions", PAYLOAD))
        self.assertEqual(final.posts[0][3]["Host"], "api.deepseek.com")
        self.assertEqual(final.posts[0][3]["Authorization"], SECRET)
        self.assertEqual(sum(e["event"] == "send_started" for e in events), 1)
        self.assert_private(events)

    def test_certificate_failure_never_retries_or_posts(self):
        conn = FakeConnection(connect_error=ssl.SSLCertVerificationError(1, "SENSITIVE_EXCEPTION_TEXT"))
        transport, events, sleeps, args = self.make([conn])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(caught.exception.safe_receipt["error_code"], "certificate_verification_failed")
        self.assertFalse(caught.exception.safe_receipt["submission_started"])
        self.assertEqual(len(args), 1)
        self.assertEqual(conn.posts, [])
        self.assertEqual(sleeps, [])
        self.assert_private(events, caught.exception)

    def test_three_connection_failures_make_no_submission(self):
        conns = [FakeConnection(connect_error=TimeoutError("SENSITIVE_EXCEPTION_TEXT")) for _ in range(3)]
        transport, events, sleeps, _ = self.make(conns)
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(len(sleeps), 2)
        self.assertEqual(caught.exception.safe_receipt["connect_attempts"], 3)
        self.assertEqual(caught.exception.safe_receipt["post_attempts"], 0)
        self.assertFalse(caught.exception.safe_receipt["submission_started"])
        self.assertTrue(all(c.closed and not c.posts for c in conns))
        self.assert_private(events, caught.exception)

    def test_post_send_failure_never_reconnects(self):
        conn = FakeConnection(send_error=BrokenPipeError("SENSITIVE_EXCEPTION_TEXT"))
        transport, events, sleeps, args = self.make([conn])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(len(args), 1)
        self.assertEqual(len(conn.posts), 1)
        self.assertTrue(caught.exception.safe_receipt["submission_started"])
        self.assertFalse(caught.exception.safe_receipt["request_body_sent"])
        self.assertEqual(caught.exception.safe_receipt["stage"], "send")
        self.assertEqual(sleeps, [])
        self.assert_private(events, caught.exception)

    def test_response_header_failure_never_reposts(self):
        conn = FakeConnection(response_error=TimeoutError("SENSITIVE_EXCEPTION_TEXT"))
        transport, events, sleeps, args = self.make([conn])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(len(args), 1)
        self.assertEqual(len(conn.posts), 1)
        self.assertTrue(caught.exception.safe_receipt["request_body_sent"])
        self.assertEqual(caught.exception.safe_receipt["stage"], "read")
        self.assertEqual(sleeps, [])
        self.assert_private(events, caught.exception)

    def test_response_body_failure_never_reposts(self):
        conn = FakeConnection(response=FakeResponse(read_error=TimeoutError("SENSITIVE_EXCEPTION_TEXT")))
        transport, events, sleeps, args = self.make([conn])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(len(args), 1)
        self.assertEqual(len(conn.posts), 1)
        self.assertEqual(caught.exception.safe_receipt["error_code"], "read_failed")
        self.assertTrue(caught.exception.safe_receipt["request_body_sent"])
        self.assertEqual(sleeps, [])
        self.assert_private(events, caught.exception)

    def test_redirect_never_followed_and_location_not_logged(self):
        response = FakeResponse(status=307, headers={"Location": "https://evil.example/SENSITIVE_EXCEPTION_TEXT"})
        conn = FakeConnection(response=response)
        transport, events, sleeps, args = self.make([conn])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(len(args), 1)
        self.assertEqual(len(conn.posts), 1)
        self.assertEqual(response.read_limits, [])
        self.assertEqual(caught.exception.safe_receipt["http_status"], 307)
        self.assertEqual(caught.exception.safe_receipt["error_code"], "http_error")
        self.assertEqual(sleeps, [])
        self.assert_private(events, caught.exception)

    def test_content_length_oversize_rejected_without_read(self):
        response = FakeResponse(headers={"Content-Length": str(MAX_RESPONSE_BYTES + 1)})
        transport, events, _, _ = self.make([FakeConnection(response=response)])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(caught.exception.safe_receipt["error_code"], "response_too_large")
        self.assertEqual(response.read_limits, [])
        self.assert_private(events, caught.exception)

    def test_missing_content_length_still_has_bounded_read(self):
        response = FakeResponse(body=b"x" * (MAX_RESPONSE_BYTES + 2))
        transport, _, _, _ = self.make([FakeConnection(response=response)])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(caught.exception.safe_receipt["error_code"], "response_too_large")
        self.assertEqual(response.read_limits, [MAX_RESPONSE_BYTES + 1])

    def test_invalid_json_is_one_submission_and_safe(self):
        transport, events, _, args = self.make([FakeConnection(response=FakeResponse(body=b"SENSITIVE_EXCEPTION_TEXT"))])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(caught.exception.safe_receipt["error_code"], "invalid_json")
        self.assertEqual(len(args), 1)
        self.assert_private(events, caught.exception)

    def test_valid_json_with_truncated_http_body_is_rejected(self):
        response = FakeResponse(body=b'{"choices":[]}', headers={"Content-Length": "100"})
        transport, _, _, args = self.make([FakeConnection(response=response)])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(caught.exception.safe_receipt["error_code"], "incomplete_response_body")
        self.assertEqual(len(args), 1)

    def test_official_sni_stays_fixed_when_connecting_to_loopback(self):
        context = mock.Mock()
        raw = mock.Mock()
        tls = mock.Mock()
        context.wrap_socket.return_value = tls
        conn = _OfficialHTTPSConnection(connect_host="127.0.0.1", connect_port=18443, timeout=10, context=context)
        with mock.patch("fact_api_transport.socket.create_connection", return_value=raw) as connect:
            conn.connect()
        connect.assert_called_once_with(("127.0.0.1", 18443), timeout=10)
        context.wrap_socket.assert_called_once_with(raw, server_hostname="api.deepseek.com")
        self.assertEqual(conn.host, "api.deepseek.com")
        self.assertEqual(conn.auto_open, 0)
        conn.close()

    def test_real_http_client_never_reopens_a_lost_socket(self):
        class LostSocketConnection(FakeConnection, http.client.HTTPConnection):
            def request(self, method, path, *, body, headers):
                self.posts.append((method, path, body, headers))
                self.sock = None
                # Exercise the real HTTPConnection.send guard, not a fake retry.
                http.client.HTTPConnection.send(self, b"test application bytes")

        conn = LostSocketConnection()
        transport, events, sleeps, args = self.make([conn])
        with self.assertRaises(TransportError) as caught:
            transport.post(PAYLOAD, SECRET, "case-1")
        self.assertEqual(caught.exception.safe_receipt["error_type"], "NotConnected")
        self.assertEqual(conn.connect_calls, 1)
        self.assertEqual(len(args), 1)
        self.assertEqual(len(conn.posts), 1)
        self.assertEqual(sleeps, [])
        self.assert_private(events, caught.exception)

    def test_each_case_gets_a_new_connection(self):
        conns = [FakeConnection(), FakeConnection()]
        transport, _, _, args = self.make(conns)
        transport.post(PAYLOAD, SECRET, "case-1")
        transport.post(PAYLOAD, SECRET, "case-2")
        self.assertEqual(len(args), 2)
        self.assertTrue(all(c.closed and len(c.posts) == 1 for c in conns))

    def test_only_official_or_literal_loopback_destinations_allowed(self):
        for host, port in [("api.deepseek.com", 443), ("127.0.0.1", 18443), ("::1", 18443)]:
            DeepSeekTransport(lambda event: None, host, port)
        for host, port in [("example.com", 443), ("localhost", 443), ("192.168.1.1", 443), ("api.deepseek.com", 8443), ("127.0.0.1", 0)]:
            with self.assertRaises(ValueError):
                DeepSeekTransport(lambda event: None, host, port)

    def test_authorization_header_newlines_rejected_before_connection(self):
        transport, _, _, args = self.make([])
        with self.assertRaises(ValueError):
            transport.post(PAYLOAD, SECRET + "\r\nX-Header: injected", "case-1")
        self.assertEqual(args, [])


if __name__ == "__main__":
    unittest.main()
