const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function waitForServer(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error('server exited before test finished'));
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for server'));
      }
    }, 100);

    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('✅ Server running on port')) {
        clearInterval(timer);
        resolve();
      }
    });

    child.stderr.on('data', (chunk) => {
      if (chunk.toString().includes('✅ Server running on port')) {
        clearInterval(timer);
        resolve();
      }
    });
  });
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  return { status: res.status, body: await res.json() };
}

async function requestForm(url, formData, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  return { status: res.status, body: await res.json() };
}

test('students submit lost items for admin approval and admins can reject them', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '4142',
      JWT_SECRET: 'test-secret',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      ADMIN_EMAIL: 'admin-item@example.com',
      ADMIN_PASSWORD: 'adminpass123',
      DB_PATH: `${__dirname}/item-approval-test.sqlite`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);

    const studentEmail = `student-item-${Date.now()}@example.com`;

    const register = await requestJson('http://127.0.0.1:4142/api/student/register', {
      method: 'POST',
      body: JSON.stringify({ email: studentEmail, password: 'studentpass123' }),
    });
    assert.equal(register.status, 200, 'student registration should succeed');

    const adminLogin = await requestJson('http://127.0.0.1:4142/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin-item@example.com', password: 'adminpass123' }),
    });
    assert.equal(adminLogin.status, 200, 'admin login should succeed');
    const adminToken = adminLogin.body.token;

    const form = new FormData();
    form.append('name', 'Wallet');
    form.append('description', 'Black wallet lost near library');

    const upload = await requestForm('http://127.0.0.1:4142/api/upload/lost', form, {
      Authorization: `Bearer ${adminToken}`,
    });
    assert.equal(upload.status, 200, 'student item upload should succeed');
    assert.match(upload.body.message, /approval/i, 'item upload should require approval');

    const pending = await requestJson('http://127.0.0.1:4142/api/admin/pending-items', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(pending.status, 200, 'pending item request should be retrievable');
    assert.equal(pending.body.pending.length >= 1, true, 'pending items list should contain at least the new request');

    const itemId = pending.body.pending[0].id;

    const reject = await requestJson('http://127.0.0.1:4142/api/admin/reject-item', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId }),
    });
    assert.equal(reject.status, 200, 'admin reject should succeed');

    const publicItems = await requestJson('http://127.0.0.1:4142/api/items/all');
    assert.equal(publicItems.status, 200, 'items list should still be reachable');
    assert.equal(publicItems.body.some(item => item.id === itemId), false, 'rejected item should not be public');
  } finally {
    child.kill('SIGTERM');
  }
});

test('admin can reject a pending student account registration', async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '4143',
      JWT_SECRET: 'test-secret',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      ADMIN_EMAIL: 'admin-reject@example.com',
      ADMIN_PASSWORD: 'adminpass123',
      DB_PATH: `${__dirname}/student-reject-test.sqlite`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);

    const email = `reject-student-${Date.now()}@example.com`;
    const register = await requestJson('http://127.0.0.1:4143/api/student/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'studentpass123' }),
    });
    assert.equal(register.status, 200, 'student registration should succeed');

    const adminLogin = await requestJson('http://127.0.0.1:4143/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin-reject@example.com', password: 'adminpass123' }),
    });
    assert.equal(adminLogin.status, 200, 'admin login should succeed');

    const pending = await requestJson('http://127.0.0.1:4143/api/admin/pending', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminLogin.body.token}` },
    });
    assert.equal(pending.status, 200, 'pending students should load');
    const target = pending.body.pending.find((u) => u.email === email);
    assert.ok(target, 'new student should appear in pending list');

    const reject = await requestJson('http://127.0.0.1:4143/api/admin/reject-student', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminLogin.body.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(reject.status, 200, 'admin reject should succeed for student account');

    const after = await requestJson('http://127.0.0.1:4143/api/admin/pending', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminLogin.body.token}` },
    });
    assert.equal(after.body.pending.some((u) => u.email === email), false, 'rejected student should no longer be pending');
  } finally {
    child.kill('SIGTERM');
  }
});
