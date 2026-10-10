package main

import (
	_ "embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/spf13/viper"
)

//go:embed resources/default_test_cases.yml
var defaultTestCasesYAML []byte

// TestCase represents a single security testing objective.
type TestCase struct {
	Title       string `mapstructure:"title"`
	Description string `mapstructure:"description"`
	Category    string `mapstructure:"category"`
}

// TestCaseProfile represents the entire test_cases.yml structure.
type TestCaseProfile struct {
	Title       string     `mapstructure:"title"`
	Description string     `mapstructure:"description"`
	Version     string     `mapstructure:"version"`
	TestCases   []TestCase `mapstructure:"test_cases"`
}

// Config represents the application configuration stored in YAML format.
// It contains settings for the proxy server and user preferences.
type Config struct {
	ConfigDir      string `mapstructure:"config_dir"`      // Current config dir
	DesktopOS      string `mapstructure:"desktop_os"`      // Operating system identifier
	FirstRun       bool   `mapstructure:"first_run"`       // Whether this is the first run of the application
	VimEnabled     bool   `mapstructure:"vim_enabled"`     // Whether vim-style keybindings are enabled
	DefaultAddress string `mapstructure:"default_address"` // Default proxy server address
	DefaultPort    string `mapstructure:"default_port"`    // Default proxy server port
	SyntaxMode     string `mapstructure:"syntax_mode"`

	// TestCaseProfile holds the parsed test cases profile.
	// Ignored by the main application viper instance.
	TestCaseProfile TestCaseProfile `mapstructure:"-"`

	// mu serializes every write to marasi_appconfig.yaml (flags and
	// keybindings) and guards the fields below.
	mu sync.Mutex
	// v reads the flat preferences. Writes never go through viper: they patch
	// the YAML document on disk (see writeConfigKeys), so sections viper would
	// reformat, such as a preserved invalid keybindings section, stay intact.
	v *viper.Viper
	// keybindings is the saved keybindings section, or the in-memory factory
	// profile when keybindingsProblem is set.
	keybindings        KeybindingConfig
	keybindingsProblem string
}

const appConfigName = "marasi_appconfig"

var configDefaults = map[string]any{
	"first_run":       true,
	"vim_enabled":     true,
	"default_address": "127.0.0.1",
	"syntax_mode":     "auto",
	"default_port":    "8080",
}

func (cfg *Config) path() string {
	return filepath.Join(cfg.ConfigDir, appConfigName+".yaml")
}

// ToggleFlag toggles a boolean configuration flag and saves the configuration to disk.
//
// Parameters:
//   - name: The name of the configuration flag to toggle
//
// Returns:
//   - error: Configuration error if the flag doesn't exist or save fails
func (cfg *Config) ToggleFlag(name string) error {
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	if !cfg.v.IsSet(name) {
		// Key doesn't exist
		return fmt.Errorf("checking if %s exists", name)
	}
	return cfg.writeFlag(name, !cfg.v.GetBool(name))
}

// SetFlag sets a configuration flag to a specific value and saves the configuration to disk.
//
// Parameters:
//   - name: The name of the configuration flag to set
//   - value: The string value to set
//
// Returns:
//   - error: Configuration error if the flag doesn't exist or save fails
func (cfg *Config) SetFlag(name string, value string) error {
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	if !cfg.v.IsSet(name) {
		// Key doesn't exist
		return fmt.Errorf("checking if %s exists", name)
	}
	return cfg.writeFlag(name, value)
}

// writeFlag persists one flag, then updates viper and the struct. On failure
// neither the file nor the in-memory config changes. Callers hold mu.
func (cfg *Config) writeFlag(name string, value any) error {
	if err := writeConfigKeys(cfg.path(), map[string]any{name: value}); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}
	cfg.v.Set(name, value)
	if err := cfg.v.Unmarshal(cfg); err != nil {
		return fmt.Errorf("unmarshalling config to struct : %w", err)
	}
	return nil
}

func LoadConfig(appConfigDir string) (*Config, error) {
	_, err := os.ReadDir(appConfigDir)
	if err != nil {
		if os.IsNotExist(err) {
			log.Println("[*] creating config dir")
			err := os.MkdirAll(appConfigDir, 0700)
			if err != nil {
				return nil, fmt.Errorf("creating config dir %s: %w", appConfigDir, err)
			}
		} else {
			return nil, fmt.Errorf("checking if directory exists %s: %w", appConfigDir, err)
		}
	}
	config := &Config{ConfigDir: appConfigDir}

	// Add missing preferences and, on first upgrade, the default keybinding
	// profile. Values already in the file, including an invalid keybindings
	// section, are never rewritten here.
	doc, err := readConfigDocument(config.path())
	if err != nil {
		return nil, fmt.Errorf("reading config file : %w", err)
	}
	missing := map[string]any{}
	for key, value := range configDefaults {
		if documentValue(doc, key) == nil {
			missing[key] = value
		}
	}
	if documentValue(doc, keybindingsKey) == nil {
		missing[keybindingsKey] = factoryKeybindings()
	}
	if len(missing) > 0 {
		if err := writeConfigKeys(config.path(), missing); err != nil {
			return nil, fmt.Errorf("writing config file : %w", err)
		}
		if doc, err = readConfigDocument(config.path()); err != nil {
			return nil, fmt.Errorf("reading config file : %w", err)
		}
	}

	config.v = viper.New()
	config.v.SetConfigName(appConfigName)
	config.v.SetConfigType("yaml")
	config.v.AddConfigPath(appConfigDir)
	for key, value := range configDefaults {
		config.v.SetDefault(key, value)
	}
	if err := config.v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("reading config file : %w", err)
	}
	if err := config.v.Unmarshal(config); err != nil {
		return nil, fmt.Errorf("unmarshalling config to struct : %w", err)
	}
	config.DesktopOS = runtime.GOOS
	config.ConfigDir = appConfigDir

	config.keybindings, err = parseKeybindings(documentValue(doc, keybindingsKey))
	if err != nil {
		config.keybindingsProblem = err.Error()
		config.keybindings = factoryKeybindings()
		log.Printf("[!] keybindings in %s left untouched, using factory shortcuts: %v", config.path(), err)
	}

	if err := loadTestCases(appConfigDir, config); err != nil {
		return nil, fmt.Errorf("loading test cases: %w", err)
	}

	return config, nil
}

// loadTestCases handles the extraction and parsing of test_cases.yml
func loadTestCases(dir string, cfg *Config) error {
	tcViper := viper.New()
	tcViper.SetConfigName("test_cases")
	tcViper.SetConfigType("yaml")
	tcViper.AddConfigPath(dir)

	testCasesPath := filepath.Join(dir, "test_cases.yml")

	// Create with default data if missing, using the embedded file.
	if _, err := os.Stat(testCasesPath); os.IsNotExist(err) {
		log.Println("[*] creating default test_cases.yml")
		if err := os.WriteFile(testCasesPath, defaultTestCasesYAML, 0600); err != nil {
			return fmt.Errorf("writing default test_cases.yml: %w", err)
		}
	}

	if err := tcViper.ReadInConfig(); err != nil {
		return fmt.Errorf("reading test_cases.yml: %w", err)
	}

	var profile TestCaseProfile
	if err := tcViper.Unmarshal(&profile); err != nil {
		return fmt.Errorf("unmarshalling test cases profile: %w", err)
	}

	// Assign the parsed profile to the main config struct
	cfg.TestCaseProfile = profile

	// tcViper is naturally garbage collected here since we don't need to save with it
	return nil
}
