package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// --- Chrome Native Messaging Protocol ---

func readMessage() (map[string]interface{}, error) {
	var length uint32
	if err := binary.Read(os.Stdin, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	if length == 0 || length > 10*1024*1024 {
		return nil, fmt.Errorf("invalid message size: %d", length)
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(os.Stdin, buf); err != nil {
		return nil, err
	}
	var msg map[string]interface{}
	if err := json.Unmarshal(buf, &msg); err != nil {
		return nil, err
	}
	return msg, nil
}

func writeMessage(obj interface{}) {
	data, err := json.Marshal(obj)
	if err != nil {
		return
	}
	length := uint32(len(data))
	binary.Write(os.Stdout, binary.LittleEndian, length)
	os.Stdout.Write(data)
}

// --- Helpers ---

func homeDir() string {
	if runtime.GOOS == "windows" {
		if h := os.Getenv("USERPROFILE"); h != "" {
			return h
		}
	}
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	dir, _ := os.UserHomeDir()
	return dir
}

func sanitizeOutput(output string) string {
	s := strings.TrimSpace(output)
	if s == "" {
		return fmt.Sprintf("zoom_recording_%d.mp4", time.Now().Unix())
	}
	// Remove leading slashes for safety
	return strings.TrimLeft(s, "/\\")
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getStringSlice(m map[string]interface{}, key string) []string {
	if v, ok := m[key]; ok {
		if arr, ok := v.([]interface{}); ok {
			var result []string
			for _, item := range arr {
				if s, ok := item.(string); ok {
					result = append(result, s)
				}
			}
			return result
		}
	}
	return nil
}

func getPayload(msg map[string]interface{}) map[string]interface{} {
	if v, ok := msg["payload"]; ok {
		if p, ok := v.(map[string]interface{}); ok {
			return p
		}
	}
	return map[string]interface{}{}
}

// --- Actions ---

func downloadWithCurl(payload map[string]interface{}, stream bool) {
	url := strings.TrimSpace(getString(payload, "url"))
	if url == "" || (!strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://")) {
		result := map[string]interface{}{"ok": false, "error": "Invalid URL"}
		if stream {
			result["type"] = "result"
		}
		writeMessage(result)
		return
	}

	home := homeDir()
	output := sanitizeOutput(getString(payload, "output"))
	absOutput := filepath.Join(home, output)

	// Build HTTP request
	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		result := map[string]interface{}{"ok": false, "error": err.Error()}
		if stream {
			result["type"] = "result"
		}
		writeMessage(result)
		return
	}

	// Add headers
	headers := getStringSlice(payload, "headers")
	for _, h := range headers {
		idx := strings.Index(h, ":")
		if idx > 0 {
			key := strings.TrimSpace(h[:idx])
			val := strings.TrimSpace(h[idx+1:])
			req.Header.Set(key, val)
		}
	}

	// Add cookies
	cookieHeader := strings.TrimSpace(getString(payload, "cookieHeader"))
	if cookieHeader != "" {
		req.Header.Set("Cookie", cookieHeader)
	}

	resp, err := client.Do(req)
	if err != nil {
		result := map[string]interface{}{"ok": false, "error": err.Error()}
		if stream {
			result["type"] = "result"
		}
		writeMessage(result)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		result := map[string]interface{}{"ok": false, "error": fmt.Sprintf("HTTP %d", resp.StatusCode)}
		if stream {
			result["type"] = "result"
		}
		writeMessage(result)
		return
	}

	// Create output file
	file, err := os.Create(absOutput)
	if err != nil {
		result := map[string]interface{}{"ok": false, "error": err.Error()}
		if stream {
			result["type"] = "result"
		}
		writeMessage(result)
		return
	}
	defer file.Close()

	// Download with progress
	totalBytes := resp.ContentLength
	var receivedBytes int64
	buf := make([]byte, 64*1024) // 64KB buffer
	lastProgress := -1

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := file.Write(buf[:n]); writeErr != nil {
				result := map[string]interface{}{"ok": false, "error": writeErr.Error()}
				if stream {
					result["type"] = "result"
				}
				writeMessage(result)
				return
			}
			receivedBytes += int64(n)

			// Send progress if streaming
			if stream && totalBytes > 0 {
				pct := int(receivedBytes * 100 / totalBytes)
				if pct != lastProgress && pct <= 100 {
					lastProgress = pct
					writeMessage(map[string]interface{}{
						"type":    "progress",
						"percent": pct,
					})
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			result := map[string]interface{}{"ok": false, "error": readErr.Error()}
			if stream {
				result["type"] = "result"
			}
			writeMessage(result)
			return
		}
	}

	result := map[string]interface{}{
		"ok":        true,
		"output":    output,
		"absOutput": absOutput,
	}
	if stream {
		result["type"] = "result"
	}
	writeMessage(result)
}

func revealFile(filePath string) {
	target := strings.TrimSpace(filePath)
	if target == "" {
		writeMessage(map[string]interface{}{"ok": false, "error": "Missing file path"})
		return
	}

	home := homeDir()
	absPath := target
	if !filepath.IsAbs(target) {
		absPath = filepath.Join(home, target)
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("explorer", "/select,", filepath.FromSlash(absPath))
	} else if runtime.GOOS == "darwin" {
		cmd = exec.Command("open", "-R", absPath)
	} else {
		// Linux: xdg-open on parent directory
		cmd = exec.Command("xdg-open", filepath.Dir(absPath))
	}

	if err := cmd.Run(); err != nil {
		// explorer returns exit code 1 even on success on Windows
		if runtime.GOOS == "windows" {
			writeMessage(map[string]interface{}{"ok": true})
			return
		}
		writeMessage(map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeMessage(map[string]interface{}{"ok": true})
}

func fileExists(filePath string) {
	target := strings.TrimSpace(filePath)
	if target == "" {
		writeMessage(map[string]interface{}{"ok": true, "exists": false})
		return
	}

	home := homeDir()
	absPath := target
	if !filepath.IsAbs(target) {
		absPath = filepath.Join(home, target)
	}

	_, err := os.Stat(absPath)
	writeMessage(map[string]interface{}{
		"ok":      true,
		"exists":  err == nil,
		"absPath": absPath,
	})
}

func uninstallSelf() {
	home := homeDir()
	hostName := "com.henry.zoomcurl"
	removed := []string{}
	errors := []string{}

	// Determine paths based on OS
	var manifestPath string
	var binaryDir string

	switch runtime.GOOS {
	case "darwin":
		manifestPath = filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts", hostName+".json")
		binaryDir = filepath.Join(home, ".config", "zoom-native-host")
	case "linux":
		manifestPath = filepath.Join(home, ".config", "google-chrome", "NativeMessagingHosts", hostName+".json")
		binaryDir = filepath.Join(home, ".config", "zoom-native-host")
	case "windows":
		binaryDir = filepath.Join(os.Getenv("LOCALAPPDATA"), "zoom-native-host")
		manifestPath = filepath.Join(binaryDir, hostName+".json")
		// Remove registry key
		cmd := exec.Command("reg", "delete", `HKCU\Software\Google\Chrome\NativeMessagingHosts\`+hostName, "/f")
		if err := cmd.Run(); err == nil {
			removed = append(removed, "registry key")
		}
	}

	// Remove manifest
	if manifestPath != "" {
		if err := os.Remove(manifestPath); err == nil {
			removed = append(removed, "manifest")
		} else if !os.IsNotExist(err) {
			errors = append(errors, "manifest: "+err.Error())
		}
	}

	// Remove binary directory (but we're running from it, so remove files inside)
	if binaryDir != "" {
		entries, _ := os.ReadDir(binaryDir)
		for _, e := range entries {
			p := filepath.Join(binaryDir, e.Name())
			// Skip self (can't delete running binary on some OS)
			if err := os.Remove(p); err == nil {
				removed = append(removed, e.Name())
			}
		}
		// Try removing dir (will fail if we're running from it — that's OK)
		os.Remove(binaryDir)
	}

	writeMessage(map[string]interface{}{
		"ok":      true,
		"removed": removed,
		"errors":  errors,
	})
}

func main() {
	msg, err := readMessage()
	if err != nil {
		writeMessage(map[string]interface{}{"ok": false, "error": "Failed to read message: " + err.Error()})
		return
	}

	action := getString(msg, "action")

	switch action {
	case "ping":
		writeMessage(map[string]interface{}{"ok": true, "version": "2.0.0", "runtime": "go"})

	case "download_with_curl":
		downloadWithCurl(getPayload(msg), false)

	case "download_with_curl_stream":
		downloadWithCurl(getPayload(msg), true)

	case "reveal_file":
		revealFile(getString(msg, "path"))

	case "file_exists":
		fileExists(getString(msg, "path"))

	case "uninstall":
		uninstallSelf()

	default:
		writeMessage(map[string]interface{}{"ok": false, "error": "Unsupported action: " + action})
	}
}
