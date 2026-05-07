package handlers

import (
	"net/http"

	"github.com/AlexArtaud-Dev/velar/backend/internal/services/adguard"
	"github.com/gin-gonic/gin"
)

type AdguardHandler struct {
	ag *adguard.Client
}

func NewAdguardHandler(ag *adguard.Client) *AdguardHandler {
	return &AdguardHandler{ag: ag}
}

func (h *AdguardHandler) GetStatus(c *gin.Context) {
	status, err := h.ag.GetStatus()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error(), "running": false})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *AdguardHandler) GetStats(c *gin.Context) {
	stats, err := h.ag.GetStats()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (h *AdguardHandler) GetFilteringStatus(c *gin.Context) {
	status, err := h.ag.GetFilteringStatus()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *AdguardHandler) SetFilteringConfig(c *gin.Context) {
	var req adguard.FilteringConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.SetFilteringConfig(req); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) AddFilter(c *gin.Context) {
	var req struct {
		URL  string `json:"url" binding:"required"`
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.AddFilter(req.URL, req.Name); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusCreated)
}

func (h *AdguardHandler) RemoveFilter(c *gin.Context) {
	var req struct {
		URL string `json:"url" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.RemoveFilter(req.URL); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) RefreshFilters(c *gin.Context) {
	if err := h.ag.RefreshFilters(); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) GetUserRules(c *gin.Context) {
	rules, err := h.ag.GetUserRules()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": rules})
}

func (h *AdguardHandler) SetUserRules(c *gin.Context) {
	var req struct {
		Rules []string `json:"rules"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Rules == nil {
		req.Rules = []string{}
	}
	if err := h.ag.SetUserRules(req.Rules); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) GetRewrites(c *gin.Context) {
	rewrites, err := h.ag.GetDNSRewrites()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rewrites": rewrites})
}

func (h *AdguardHandler) AddRewrite(c *gin.Context) {
	var req adguard.DNSRewrite
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Domain == "" || req.Answer == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain and answer are required"})
		return
	}
	if err := h.ag.AddDNSRewrite(req.Domain, req.Answer); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusCreated)
}

func (h *AdguardHandler) DeleteRewrite(c *gin.Context) {
	var req adguard.DNSRewrite
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.DeleteDNSRewrite(req.Domain, req.Answer); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) SetProtection(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.SetProtection(req.Enabled); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) GetSafeBrowsingStatus(c *gin.Context) {
	enabled, err := h.ag.GetSafeBrowsingStatus()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": enabled})
}

func (h *AdguardHandler) SetSafeBrowsing(c *gin.Context) {
	var req struct{ Enabled bool `json:"enabled"` }
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.SetSafeBrowsing(req.Enabled); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) GetParentalStatus(c *gin.Context) {
	enabled, err := h.ag.GetParentalStatus()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": enabled})
}

func (h *AdguardHandler) SetParental(c *gin.Context) {
	var req struct{ Enabled bool `json:"enabled"` }
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.SetParental(req.Enabled); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AdguardHandler) GetSafeSearchStatus(c *gin.Context) {
	settings, err := h.ag.GetSafeSearchStatus()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

func (h *AdguardHandler) SetSafeSearch(c *gin.Context) {
	var req adguard.SafeSearchSettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.ag.SetSafeSearch(req); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
