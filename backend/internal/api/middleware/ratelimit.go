package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type bucket struct {
	count    int
	resetAt  time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	max     int
	window  time.Duration
}

func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets: make(map[string]*bucket),
		max:     max,
		window:  window,
	}
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		rl.mu.Lock()
		b, ok := rl.buckets[key]
		if !ok || time.Now().After(b.resetAt) {
			b = &bucket{resetAt: time.Now().Add(rl.window)}
			rl.buckets[key] = b
		}
		b.count++
		count := b.count
		rl.mu.Unlock()

		if count > rl.max {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
			return
		}
		c.Next()
	}
}

func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		for key, b := range rl.buckets {
			if time.Now().After(b.resetAt) {
				delete(rl.buckets, key)
			}
		}
		rl.mu.Unlock()
	}
}
