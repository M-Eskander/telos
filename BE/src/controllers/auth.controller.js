const passport = require('../middleware/auth.middleware');
const authService = require('../services/auth.service');

exports.login = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ ok: false, message: info && info.message });
    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, roles: user.roles } });
    });
  })(req, res, next);
};

exports.logout = (req, res) => {
  req.logout(() => {});
  req.session && req.session.destroy(() => res.json({ ok: true }));
};

exports.me = (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ ok: false });
  res.json({ ok: true, user: { id: req.user.id, name: req.user.name, email: req.user.email, roles: req.user.roles } });
};

exports.register = async (req, res, next) => {
  try {
    const body = req.body || {};
    const { name, phone_number, email, password } = body;

    if (!name || !phone_number || !email || !password)
      return res.status(400).json({ ok: false, message: 'Missing required fields' });

    const existing = await authService.findUserByEmail(email);

    if (existing)
      return res.status(409).json({ ok: false, message: 'Email already registered' });

    const user = await authService.createUser({
      name,
      phone_number,
      email,
      password,
      roles: ['user']
    });

    res.status(201).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        created_at: user.created_at,
        roles: user.roles
      }
    });
  } catch (err) {
    next(err);
  }
};
