import type { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

export const createRateLimiter = (options: RateLimitOptions) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  // Periodically clean expired entries
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of requests.entries()) {
      if (now > entry.resetTime) {
        requests.delete(ip);
      }
    }
  }, options.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let record = requests.get(ip);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + options.windowMs };
      requests.set(ip, record);
    } else {
      record.count += 1;
    }

    res.setHeader('X-RateLimit-Limit', options.max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.max) {
      return res.status(429).json({
        error: options.message || 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد تلاش کنید.',
      });
    }

    next();
  };
};

export const authRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 attempts per 5 minutes
  message: 'تعداد تلاش‌های ورود بیش از حد مجاز است. ۵ دقیقه دیگر امتحان کنید.',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // 600 requests per minute
});
