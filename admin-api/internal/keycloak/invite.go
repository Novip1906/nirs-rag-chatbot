package keycloak

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

type InviteLink struct {
	Link string
	Sent bool
}

func (c *Client) WithInvite(clientID, redirectURL string) *Client {
	c.inviteClientID = clientID
	c.inviteRedirectURL = redirectURL
	return c
}

func (c *Client) CreateInvited(ctx context.Context, employeeID string, p Profile) (string, error) {
	body := userBody(employeeID, p)
	body["requiredActions"] = []string{"UPDATE_PASSWORD"}
	return c.createUser(ctx, p.Email, body)
}

func (c *Client) MagicLink(ctx context.Context, sub, email string, ttl time.Duration) (InviteLink, error) {
	body := map[string]any{
		"email":              email,
		"client_id":          c.inviteClientID,
		"redirect_uri":       c.inviteRedirectURL,
		"expiration_seconds": int(ttl.Seconds()),
		"force_create":       false,
		"reusable":           false,
		"remember_me":        true,
		"send_email":         true,
	}
	var out struct {
		UserID string `json:"user_id"`
		Link   string `json:"link"`
		Sent   bool   `json:"sent"`
	}
	target := c.baseURL + "/realms/" + url.PathEscape(c.realm) + "/magic-link"
	if _, err := c.doURL(ctx, http.MethodPost, target, body, &out); err != nil {
		return InviteLink{}, err
	}
	if out.Link == "" || out.UserID != sub {
		return InviteLink{}, fmt.Errorf("%w: unexpected magic link response", domain.ErrIdPRejected)
	}
	return InviteLink{Link: out.Link, Sent: out.Sent}, nil
}

func (c *Client) HasPassword(ctx context.Context, sub string) (bool, error) {
	var creds []struct {
		Type string `json:"type"`
	}
	if _, err := c.do(ctx, http.MethodGet, "/users/"+url.PathEscape(sub)+"/credentials", nil, &creds); err != nil {
		return false, err
	}
	for _, cr := range creds {
		if cr.Type == "password" {
			return true, nil
		}
	}
	return false, nil
}

func (c *Client) FindByEmail(ctx context.Context, email string) (User, bool, error) {
	return c.lookupByEmail(ctx, email)
}
