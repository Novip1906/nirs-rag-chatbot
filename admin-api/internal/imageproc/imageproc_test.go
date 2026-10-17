package imageproc

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, jpeg.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h)), nil))
	return buf.Bytes()
}

func withOrientation(raw []byte, orientation byte) []byte {
	exif := []byte{0xFF, 0xE1, 0x00, 0x22, 'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 0x2A, 0, 0, 0, 8,
		0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0}
	out := append([]byte{}, raw[:2]...)
	out = append(out, exif...)
	return append(out, raw[2:]...)
}

func hugePNG(t *testing.T) []byte {
	t.Helper()
	return pngHeader(t, 20000, 20000)
}

func pngHeader(t *testing.T, w, h uint32) []byte {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	b := buf.Bytes()
	binary.BigEndian.PutUint32(b[16:20], w)
	binary.BigEndian.PutUint32(b[20:24], h)
	binary.BigEndian.PutUint32(b[29:33], crc32.ChecksumIEEE(b[12:29]))
	return b
}

func size(t *testing.T, raw []byte) (int, int) {
	t.Helper()
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	require.NoError(t, err)
	require.Equal(t, "jpeg", format)
	return cfg.Width, cfg.Height
}

func TestNormalize_FitsInto512(t *testing.T) {
	out, err := Normalize(context.Background(), jpegOf(t, 2000, 1000))
	require.NoError(t, err)
	w, h := size(t, out)
	require.Equal(t, 512, w)
	require.Equal(t, 256, h)
}

func TestNormalize_KeepsSmallImageSize(t *testing.T) {
	out, err := Normalize(context.Background(), jpegOf(t, 40, 20))
	require.NoError(t, err)
	w, h := size(t, out)
	require.Equal(t, 40, w)
	require.Equal(t, 20, h)
}

func TestNormalize_AppliesOrientation(t *testing.T) {
	out, err := Normalize(context.Background(), withOrientation(jpegOf(t, 40, 20), 6))
	require.NoError(t, err)
	w, h := size(t, out)
	require.Equal(t, 20, w)
	require.Equal(t, 40, h)
}

func TestNormalize_StripsExif(t *testing.T) {
	out, err := Normalize(context.Background(), withOrientation(jpegOf(t, 40, 20), 6))
	require.NoError(t, err)
	require.False(t, bytes.Contains(out, []byte("Exif")))
}

func TestNormalize_RejectsHugeDimensions(t *testing.T) {
	_, err := Normalize(context.Background(), hugePNG(t))
	require.ErrorIs(t, err, ErrTooLarge)
}

func TestNormalize_RejectsOtherFormatsAndGarbage(t *testing.T) {
	_, err := Normalize(context.Background(), []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"))
	require.ErrorIs(t, err, ErrInvalid)
	_, err = Normalize(context.Background(), []byte("это не картинка"))
	require.ErrorIs(t, err, ErrInvalid)
	_, err = Normalize(context.Background(), make([]byte, MaxBytes+1))
	require.ErrorIs(t, err, ErrTooLarge)
}

func TestNormalize_FlattensTransparentPNGOnWhite(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, src))
	out, err := Normalize(context.Background(), buf.Bytes())
	require.NoError(t, err)
	img, err := jpeg.Decode(bytes.NewReader(out))
	require.NoError(t, err)
	r, g, b, _ := img.At(4, 4).RGBA()
	require.Greater(t, r>>8, uint32(240))
	require.Greater(t, g>>8, uint32(240))
	require.Greater(t, b>>8, uint32(240))
}

func TestNormalize_RejectsOverSixteenMegapixels(t *testing.T) {
	_, err := Normalize(context.Background(), pngHeader(t, 4001, 4000))
	require.ErrorIs(t, err, ErrTooLarge)
	_, err = Normalize(context.Background(), pngHeader(t, 4000, 4000))
	require.ErrorIs(t, err, ErrInvalid)
}

func TestNormalize_OneAtATime(t *testing.T) {
	require.Equal(t, 1, cap(slot))
	slot <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := Normalize(ctx, jpegOf(t, 40, 20))
	require.ErrorIs(t, err, context.DeadlineExceeded)
	_, err = Normalize(context.Background(), []byte("это не картинка"))
	require.ErrorIs(t, err, ErrInvalid)
	<-slot
	_, err = Normalize(context.Background(), jpegOf(t, 40, 20))
	require.NoError(t, err)
	require.Empty(t, slot)
}
