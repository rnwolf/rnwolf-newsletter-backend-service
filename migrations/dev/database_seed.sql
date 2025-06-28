-- database_seed.sql
-- This file contains sample data for seeding development and testing databases.
-- It should NOT be applied to production environments.

-- Sample verified subscriber (grandfathered user)
INSERT INTO subscribers (
    email,
    subscribed_at,
    email_verified,
    verified_at,
    ip_address,
    country
) VALUES (
    'existing.user@rnwolf.net',
    '2024-01-01T00:00:00Z',
    TRUE,
    '2024-01-01T00:00:00Z',
    '192.168.1.1',
    'GB'
);

-- Sample unverified subscriber (pending verification)
INSERT INTO subscribers (
    email,
    subscribed_at,
    email_verified,
    verification_token,
    verification_sent_at,
    ip_address,
    country
) VALUES (
    'pending.verification@rnwolf.net',
    datetime('now'),
    FALSE,
    'dGVzdC12ZXJpZmljYXRpb24tdG9rZW4=', -- base64url encoded test token
    datetime('now'),
    '192.168.1.2',
    'US'
);

-- Sample subscriber for general testing
INSERT INTO subscribers (
    email,
    subscribed_at,
    email_verified,
    verified_at,
    ip_address,
    user_agent,
    country,
    city
) VALUES (
    'test@rnwolf.net',
    '2024-06-01T10:00:00Z',
    TRUE,
    '2024-06-01T10:00:00Z',
    '192.168.1.3',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'CA',
    'Toronto'
);

-- Another unverified subscriber
INSERT INTO subscribers (
    email,
    subscribed_at,
    email_verified,
    verification_token,
    verification_sent_at,
    ip_address,
    country
) VALUES (
    'another.pending@rnwolf.net',
    datetime('now', '-1 hour'),
    FALSE,
    'YW5vdGhlci10ZXN0LXRva2Vu',
    datetime('now', '-1 hour'),
    '192.168.1.4',
    'DE'
);