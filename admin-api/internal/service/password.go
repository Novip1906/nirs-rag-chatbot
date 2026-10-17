package service

import (
	"crypto/rand"
	"math/big"
	"strings"
)

const (
	passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
	passwordGroups   = 3
	passwordGroupLen = 4
)

func GeneratePassword() string {
	max := big.NewInt(int64(len(passwordAlphabet)))
	for {
		var b strings.Builder
		for g := 0; g < passwordGroups; g++ {
			if g > 0 {
				b.WriteByte('-')
			}
			for i := 0; i < passwordGroupLen; i++ {
				n, err := rand.Int(rand.Reader, max)
				if err != nil {
					panic(err)
				}
				b.WriteByte(passwordAlphabet[n.Int64()])
			}
		}
		p := b.String()
		if strings.ContainsAny(p, "23456789") && strings.ContainsAny(p, "abcdefghijkmnpqrstuvwxyz") && strings.ContainsAny(p, "ABCDEFGHJKLMNPQRSTUVWXYZ") {
			return p
		}
	}
}
