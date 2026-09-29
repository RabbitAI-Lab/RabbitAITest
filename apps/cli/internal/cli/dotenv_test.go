package cli

import (
	"os"
	"testing"
)

func TestLoadDotenv(t *testing.T) {
	dir := t.TempDir()
	content := EnvVar("TOKEN") + "=tok123\n" + EnvVar("BASE_URL") + "=\"https://x.example.com\"\n"
	os.WriteFile(dir+"/.env.local", []byte(content), 0o600)
	cwd, _ := os.Getwd()
	defer os.Chdir(cwd)
	// 卸载后恢复环境（EffectiveConfig 的 env 覆盖会穿透包内其他测试——os.Setenv 泄漏教训）
	defer os.Unsetenv(EnvVar("TOKEN"))
	defer os.Unsetenv(EnvVar("BASE_URL"))
	os.Chdir(dir)
	LoadDotenv()
	if os.Getenv(EnvVar("TOKEN")) != "tok123" {
		t.Fatalf("token not loaded: %q", os.Getenv(EnvVar("TOKEN")))
	}
	if os.Getenv(EnvVar("BASE_URL")) != "https://x.example.com" {
		t.Fatalf("base url not loaded: %q", os.Getenv(EnvVar("BASE_URL")))
	}
}
