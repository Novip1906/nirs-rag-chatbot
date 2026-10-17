package imageproc

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	_ "image/jpeg"
	_ "image/png"

	"github.com/disintegration/imaging"
)

const (
	MaxBytes  = 5 << 20
	maxPixels = 16_000_000
	maxSide   = 512
	quality   = 85
)

var (
	ErrInvalid  = errors.New("invalid image")
	ErrTooLarge = errors.New("image too large")
)

var slot = make(chan struct{}, 1)

func Normalize(ctx context.Context, raw []byte) ([]byte, error) {
	if len(raw) > MaxBytes {
		return nil, ErrTooLarge
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") {
		return nil, ErrInvalid
	}
	if cfg.Width*cfg.Height > maxPixels {
		return nil, ErrTooLarge
	}
	select {
	case slot <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-slot }()
	img, err := imaging.Decode(bytes.NewReader(raw), imaging.AutoOrientation(true))
	if err != nil {
		return nil, ErrInvalid
	}
	fitted := imaging.Fit(img, maxSide, maxSide, imaging.Lanczos)
	canvas := imaging.New(fitted.Bounds().Dx(), fitted.Bounds().Dy(), color.White)
	flat := imaging.Overlay(canvas, fitted, image.Point{}, 1)
	var out bytes.Buffer
	if err := imaging.Encode(&out, flat, imaging.JPEG, imaging.JPEGQuality(quality)); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
