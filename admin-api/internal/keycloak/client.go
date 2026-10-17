package keycloak

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/domain"
)

const (
	requestTimeout = 10 * time.Second
	findRetryDelay = 500 * time.Millisecond
	pageSize       = 100
)

type Client struct {
	baseURL           string
	realm             string
	http              *http.Client
	tokens            *TokenSource
	inviteClientID    string
	inviteRedirectURL string
}

func New(adminURL, realm, clientID, secret string) *Client {
	base := strings.TrimRight(adminURL, "/")
	httpClient := &http.Client{Timeout: requestTimeout}
	return &Client{
		baseURL: base,
		realm:   realm,
		http:    httpClient,
		tokens:  NewTokenSource(TokenEndpoint(base, realm), clientID, secret, httpClient),
	}
}

type User struct {
	ID         string
	Username   string
	Email      string
	FirstName  string
	LastName   string
	Enabled    bool
	EmployeeID string
	Groups     []string
}

type Profile struct {
	Email     string
	FirstName string
	LastName  string
	Enabled   bool
}

type userRepresentation struct {
	ID         string              `json:"id"`
	Username   string              `json:"username"`
	Email      string              `json:"email"`
	FirstName  string              `json:"firstName"`
	LastName   string              `json:"lastName"`
	Enabled    bool                `json:"enabled"`
	Attributes map[string][]string `json:"attributes"`
}

func (c *Client) CreateUser(ctx context.Context, employeeID string, p Profile, temporaryPassword string) (string, error) {
	body := userBody(employeeID, p)
	body["credentials"] = []map[string]any{{"type": "password", "value": temporaryPassword, "temporary": true}}
	return c.createUser(ctx, p.Email, body)
}

func userBody(employeeID string, p Profile) map[string]any {
	return map[string]any{
		"username":      p.Email,
		"email":         p.Email,
		"firstName":     p.FirstName,
		"lastName":      p.LastName,
		"enabled":       p.Enabled,
		"emailVerified": true,
		"attributes":    map[string][]string{"employeeId": {employeeID}},
	}
}

func (c *Client) createUser(ctx context.Context, email string, body map[string]any) (string, error) {
	resp, err := c.do(ctx, http.MethodPost, "/users", body, nil)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusConflict {
			return "", domain.ErrEmailTaken
		}
		return "", err
	}
	location := resp.Header.Get("Location")
	if sub := location[strings.LastIndex(location, "/")+1:]; sub != "" {
		return sub, nil
	}
	sub, err := c.findByEmail(ctx, email)
	if err == nil {
		return sub, nil
	}
	select {
	case <-ctx.Done():
	case <-time.After(findRetryDelay):
	}
	sub, err = c.findByEmail(ctx, email)
	if err != nil {
		slog.Error("учётная запись создана, но её идентификатор не получен", "email", email, "error", err)
		return "", fmt.Errorf("%w: created user id not obtained", domain.ErrIdPUnavailable)
	}
	return sub, nil
}

func (c *Client) lookupByEmail(ctx context.Context, email string) (User, bool, error) {
	var found []userRepresentation
	path := "/users?exact=true&email=" + url.QueryEscape(email)
	if _, err := c.do(ctx, http.MethodGet, path, nil, &found); err != nil {
		return User{}, false, err
	}
	for _, u := range found {
		if strings.EqualFold(strings.TrimSpace(u.Email), email) && u.ID != "" {
			return toUser(u), true, nil
		}
	}
	return User{}, false, nil
}

func (c *Client) findByEmail(ctx context.Context, email string) (string, error) {
	u, found, err := c.lookupByEmail(ctx, email)
	if err != nil {
		return "", err
	}
	if !found {
		return "", fmt.Errorf("%w: created user not found by email", domain.ErrIdPUnavailable)
	}
	return u.ID, nil
}

func (c *Client) UpdateUser(ctx context.Context, sub string, p Profile) error {
	path := "/users/" + url.PathEscape(sub)
	var current map[string]any
	if _, err := c.do(ctx, http.MethodGet, path, nil, &current); err != nil {
		return err
	}
	current["email"] = p.Email
	current["firstName"] = p.FirstName
	current["lastName"] = p.LastName
	current["enabled"] = p.Enabled
	_, err := c.do(ctx, http.MethodPut, path, current, nil)
	return err
}

func (c *Client) SetPassword(ctx context.Context, sub, temporaryPassword string) error {
	body := map[string]any{"type": "password", "value": temporaryPassword, "temporary": true}
	_, err := c.do(ctx, http.MethodPut, "/users/"+url.PathEscape(sub)+"/reset-password", body, nil)
	return err
}

func (c *Client) Logout(ctx context.Context, sub string) error {
	_, err := c.do(ctx, http.MethodPost, "/users/"+url.PathEscape(sub)+"/logout", nil, nil)
	return err
}

func (c *Client) DeleteUser(ctx context.Context, sub string) error {
	_, err := c.do(ctx, http.MethodDelete, "/users/"+url.PathEscape(sub), nil, nil)
	if err != nil && !errors.Is(err, domain.ErrIdPAccountMissing) {
		return err
	}
	return nil
}

func (c *Client) GetProfile(ctx context.Context, sub string) (User, error) {
	var rep userRepresentation
	if _, err := c.do(ctx, http.MethodGet, "/users/"+url.PathEscape(sub), nil, &rep); err != nil {
		return User{}, err
	}
	return toUser(rep), nil
}

func (c *Client) GetUser(ctx context.Context, sub string) (User, error) {
	u, err := c.GetProfile(ctx, sub)
	if err != nil {
		return User{}, err
	}
	return c.attachGroups(ctx, u)
}

func (c *Client) ListUsers(ctx context.Context) ([]User, error) {
	var users []User
	for first := 0; ; first += pageSize {
		var page []userRepresentation
		path := "/users?first=" + strconv.Itoa(first) + "&max=" + strconv.Itoa(pageSize)
		if _, err := c.do(ctx, http.MethodGet, path, nil, &page); err != nil {
			return nil, err
		}
		if len(page) == 0 {
			return users, nil
		}
		for _, rep := range page {
			u, err := c.attachGroups(ctx, toUser(rep))
			if err != nil {
				return nil, err
			}
			users = append(users, u)
		}
	}
}

func toUser(rep userRepresentation) User {
	u := User{
		ID:        rep.ID,
		Username:  rep.Username,
		Email:     rep.Email,
		FirstName: rep.FirstName,
		LastName:  rep.LastName,
		Enabled:   rep.Enabled,
	}
	if ids := rep.Attributes["employeeId"]; len(ids) > 0 {
		u.EmployeeID = ids[0]
	}
	return u
}

func (c *Client) attachGroups(ctx context.Context, u User) (User, error) {
	var groups []struct {
		Name string `json:"name"`
	}
	if _, err := c.do(ctx, http.MethodGet, "/users/"+url.PathEscape(u.ID)+"/groups", nil, &groups); err != nil {
		return User{}, err
	}
	for _, g := range groups {
		u.Groups = append(u.Groups, g.Name)
	}
	return u, nil
}

func (c *Client) adminURL(path string) string {
	return c.baseURL + "/admin/realms/" + url.PathEscape(c.realm) + path
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) (*http.Response, error) {
	return c.doURL(ctx, method, c.adminURL(path), in, out)
}

func (c *Client) doURL(ctx context.Context, method, target string, in, out any) (*http.Response, error) {
	var payload []byte
	if in != nil {
		var err error
		if payload, err = json.Marshal(in); err != nil {
			return nil, err
		}
	}
	for attempt := 0; ; attempt++ {
		token, err := c.tokens.Token(ctx)
		if err != nil {
			return nil, err
		}
		resp, err := c.send(ctx, method, target, token, payload, out)
		if resp != nil && resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			c.tokens.Invalidate(token)
			continue
		}
		return resp, err
	}
}

func (c *Client) send(ctx context.Context, method, target, token string, payload []byte, out any) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrIdPUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if out != nil {
			if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
				return resp, fmt.Errorf("%w: invalid response body", domain.ErrIdPUnavailable)
			}
		}
		return resp, nil
	}
	return resp, statusError(resp.StatusCode)
}

func statusError(status int) error {
	switch {
	case status == http.StatusNotFound:
		return domain.ErrIdPAccountMissing
	case status == http.StatusUnauthorized, status == http.StatusForbidden, status >= 500:
		return fmt.Errorf("%w: status %d", domain.ErrIdPUnavailable, status)
	default:
		return fmt.Errorf("%w: status %d", domain.ErrIdPRejected, status)
	}
}
