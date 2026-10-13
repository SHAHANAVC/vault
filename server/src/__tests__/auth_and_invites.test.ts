import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../app';
import { User } from '../models/User';
import { Household } from '../models/Household';
import { Invite } from '../models/Invite';

describe('Phase 3: Auth & Partner Onboarding Integration Tests', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    // Start in-memory replica set to support multi-document ACID transactions
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [
        {
          launchTimeout: 60000,
        },
      ],
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri);
  }, 90000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }
  }, 30000);

  beforeEach(async () => {
    // Clear collections between tests for deterministic isolation
    await User.deleteMany({});
    await Household.deleteMany({});
    await Invite.deleteMany({});
  });

  describe('Registration & ACID Transactions', () => {
    it('creates user and household atomically inside one MongoDB session', async () => {
      const res = await request(app).post('/auth/register').send({
        name: 'Priya Nair',
        email: 'priya@example.com',
        password: 'Password123',
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.name).toBe('Priya Nair');
      expect(res.body.user.email).toBe('priya@example.com');
      expect(res.body.user.householdId).toBeDefined();
      expect(res.body.user.passwordHash).toBeUndefined(); // Never exposed

      // Verify DB records
      const userDoc = await User.findOne({ email: 'priya@example.com' });
      expect(userDoc).not.toBeNull();

      const householdDoc = await Household.findById(userDoc?.householdId);
      expect(householdDoc).not.toBeNull();
      expect(householdDoc?.members.map((m) => m.toString())).toContain(
        userDoc?._id.toString()
      );
    });

    it('rejects registration with a duplicate email', async () => {
      // First registration
      await request(app).post('/auth/register').send({
        name: 'Priya Nair',
        email: 'priya@example.com',
        password: 'Password123',
      });

      // Duplicate registration attempt
      const res = await request(app).post('/auth/register').send({
        name: 'Priya Duplicate',
        email: 'PRIYA@example.com', // case-insensitive check
        password: 'Password123',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('rejects registration with a weak password', async () => {
      const res = await request(app).post('/auth/register').send({
        name: 'Priya Nair',
        email: 'priya@example.com',
        password: 'weak', // fewer than 8 chars, missing uppercase & digit
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid registration input/i);
      expect(res.body.errors?.password).toBeDefined();
    });
  });

  describe('Login, Timing Equalization & Cookie Flags', () => {
    beforeEach(async () => {
      // Seed a test user
      await request(app).post('/auth/register').send({
        name: 'Rahul Sharma',
        email: 'rahul@example.com',
        password: 'Password123',
      });
    });

    it('login with wrong password returns generic error message', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'rahul@example.com',
        password: 'WrongPassword999',
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('login with non-existent email returns identical generic error message', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'Password123',
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('sets HTTP-only cookie with correct security flags on successful login', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'rahul@example.com',
        password: 'Password123',
      });

      expect(res.status).toBe(200);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const tokenCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('token='))
        : cookies;

      expect(tokenCookie).toBeDefined();
      expect(tokenCookie).toMatch(/HttpOnly/i);
      expect(tokenCookie).toMatch(/SameSite=Lax/i);
      expect(tokenCookie).toMatch(/Path=\//i);
    });

    it('GET /auth/me without a cookie returns 401 Unauthorized', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Authentication required/i);
    });

    it('GET /auth/me with valid cookie returns user profile', async () => {
      const loginRes = await request(app).post('/auth/login').send({
        email: 'rahul@example.com',
        password: 'Password123',
      });

      const cookie = (loginRes.headers['set-cookie'] as unknown as string[]) ?? [];

      const meRes = await request(app).get('/auth/me').set('Cookie', cookie);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.name).toBe('Rahul Sharma');
      expect(meRes.body.user.email).toBe('rahul@example.com');
      expect(meRes.body.partner).toBeNull();
    });
  });

  describe('Partner Invites', () => {
    let inviterCookie: string[];
    let inviterUserId: string;

    beforeEach(async () => {
      const reg = await request(app).post('/auth/register').send({
        name: 'Arjun Mehta',
        email: 'arjun@example.com',
        password: 'Password123',
      });

      inviterCookie = (reg.headers['set-cookie'] as unknown as string[]) ?? [];
      inviterUserId = reg.body.user.id;
    });

    it('creates single-use invite and ensures raw token is NOT stored in DB', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      expect(inviteRes.status).toBe(201);
      const { token: rawToken, inviteUrl } = inviteRes.body;

      expect(rawToken).toBeDefined();
      expect(inviteUrl).toContain(`/invite/${rawToken}`);

      // Verify DB: Raw token must NOT exist in the database!
      const inviteWithRaw = await Invite.findOne({ tokenHash: rawToken });
      expect(inviteWithRaw).toBeNull();

      // Only the hashed token should be found
      const storedInvite = await Invite.findOne({ status: 'pending' });
      expect(storedInvite).not.toBeNull();
      expect(storedInvite?.tokenHash).not.toBe(rawToken);
      expect(storedInvite?.tokenHash).toHaveLength(64); // SHA-256 hex string
    });

    it('preview endpoint returns only safe info without private data', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      const rawToken = inviteRes.body.token;

      const previewRes = await request(app).get(`/invites/${rawToken}/preview`);

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.valid).toBe(true);
      expect(previewRes.body.isExpired).toBe(false);
      expect(previewRes.body.inviterFirstName).toBe('Arjun'); // First name only
      expect(previewRes.body.email).toBeUndefined(); // Email is hidden
      expect(previewRes.body.householdId).toBeUndefined(); // Household is hidden
    });

    it('register with inviteToken successfully joins partner household', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      const rawToken = inviteRes.body.token;

      // Partner signs up using the inviteToken
      const partnerRegRes = await request(app).post('/auth/register').send({
        name: 'Sneha Patel',
        email: 'sneha@example.com',
        password: 'Password123',
        inviteToken: rawToken,
      });

      expect(partnerRegRes.status).toBe(201);

      // Verify both members now belong to the EXACT same household
      const arjunDoc = await User.findById(inviterUserId);
      const snehaDoc = await User.findOne({ email: 'sneha@example.com' });

      expect(snehaDoc?.householdId.toString()).toBe(arjunDoc?.householdId.toString());

      const household = await Household.findById(arjunDoc?.householdId);
      expect(household?.members).toHaveLength(2);

      // Invite is now accepted and single-use
      const inviteDoc = await Invite.findOne({ usedBy: snehaDoc?._id });
      expect(inviteDoc?.status).toBe('accepted');
    });

    it('single-use invite fails if used a second time', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      const rawToken = inviteRes.body.token;

      // 1st acceptance
      await request(app).post('/auth/register').send({
        name: 'Sneha Patel',
        email: 'sneha@example.com',
        password: 'Password123',
        inviteToken: rawToken,
      });

      // 2nd acceptance attempt with same token
      const secondRes = await request(app).post('/auth/register').send({
        name: 'Third Person',
        email: 'third@example.com',
        password: 'Password123',
        inviteToken: rawToken,
      });

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.message).toMatch(/Invalid or expired invite token/i);
    });

    it('rejects accepting your own invitation', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      const rawToken = inviteRes.body.token;

      // Inviter tries to accept their own invite
      const acceptRes = await request(app)
        .post(`/invites/${rawToken}/accept`)
        .set('Cookie', inviterCookie);

      expect(acceptRes.status).toBe(400);
      expect(acceptRes.body.message).toMatch(/cannot accept your own invitation/i);
    });

    it('rejects expired invitations', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      const rawToken = inviteRes.body.token;

      // Force invite expiration in DB
      await Invite.updateOne({}, { expiresAt: new Date(Date.now() - 1000) });

      const acceptRes = await request(app).post('/auth/register').send({
        name: 'Late Joiner',
        email: 'late@example.com',
        password: 'Password123',
        inviteToken: rawToken,
      });

      expect(acceptRes.status).toBe(400);
      expect(acceptRes.body.message).toMatch(/Invalid or expired invite token/i);
    });

    it('rejects third member joining a full household (max 2 members rule)', async () => {
      const inviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie)
        .send({ expiresInDays: 7 });

      const rawToken = inviteRes.body.token;

      // 2nd member joins
      await request(app).post('/auth/register').send({
        name: 'Sneha Patel',
        email: 'sneha@example.com',
        password: 'Password123',
        inviteToken: rawToken,
      });

      // Create another invite directly in DB or try to join
      const arjunDoc = await User.findById(inviterUserId);
      const household = await Household.findById(arjunDoc?.householdId);
      expect(household?.members).toHaveLength(2);

      // Attempting to create an invite when household already has 2 members must fail
      const fullInviteRes = await request(app)
        .post('/invites')
        .set('Cookie', inviterCookie);

      expect(fullInviteRes.status).toBe(400);
      expect(fullInviteRes.body.message).toMatch(/already has 2 members/i);
    });
  });

  describe('Rate Limiting', () => {
    it('triggers 429 when rate limit is exceeded', async () => {
      // Hit test rate limiter 2 times (allowed)
      const res1 = await request(app).get('/api/test-rate-limit');
      expect(res1.status).toBe(200);

      const res2 = await request(app).get('/api/test-rate-limit');
      expect(res2.status).toBe(200);

      // 3rd hit must exceed the limit of 2 requests
      const res3 = await request(app).get('/api/test-rate-limit');
      expect(res3.status).toBe(429);
      expect(res3.body.message).toMatch(/Rate limit exceeded/i);
    });
  });
});
