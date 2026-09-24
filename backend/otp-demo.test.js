const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function waitForServer(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const output = (child.stdout.readable ? '' : '');
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error('server exited before test finished'));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for server'));
        return;
      }
    }, 100);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('✅ Server running on port')) {
        clearInterval(timer);
        resolve();
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('✅ Server running on port')) {
        clearInterval(timer);
        resolve();
      }
    });
  });
}

function requestJson(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  }).then(async (res) => ({
    status: res.status,
    body: await res.json(),
  }));
}

test('OTP demo mode logs the generated code and validates the exact OTP', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '4141',
      JWT_SECRET: 'test-secret',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      ADMIN_EMAIL: 'admin-test@example.com',
      ADMIN_PASSWORD: 'adminpass123',
      DB_PATH: `${__dirname}/otp-demo-test.sqlite`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    await waitForServer(child);

    const uniqueId = Date.now();
    const email = `student-demo-${uniqueId}@example.com`;
    const register = await requestJson('http://127.0.0.1:4141/api/student/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'studentpass123' }),
    });
    assert.equal(register.status, 200, 'student registration should succeed');

    const otpRequest = await requestJson('http://127.0.0.1:4141/api/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    assert.equal(otpRequest.status, 200, 'OTP request should succeed');
    assert.match(otpRequest.body.message, /OTP/, 'request should mention OTP');

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.match(output, new RegExp(`OTP for .*${email}`, 'i'), 'demo mode should log the OTP');

    const invalidReset = await requestJson('http://127.0.0.1:4141/api/otp/reset', {
      method: 'POST',
      body: JSON.stringify({ email, otp: '000000', newPassword: 'newpass123' }),
    });
    assert.equal(invalidReset.status, 400, 'wrong OTP should be rejected');
  } finally {
    child.kill('SIGTERM');
  }
});
