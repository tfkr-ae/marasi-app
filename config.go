package main

import (
	"fmt"
	"log"
	"os"
	"runtime"

	"github.com/spf13/viper"
)

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
}

// ToggleFlag toggles a boolean configuration flag and saves the configuration to disk.
//
// Parameters:
//   - name: The name of the configuration flag to toggle
//
// Returns:
//   - error: Configuration error if the flag doesn't exist or save fails
func (cfg *Config) ToggleFlag(name string) error {
	if !viper.IsSet(name) {
		// Key doesn't exist
		return fmt.Errorf("checking if %s exists", name)
	}
	flag := viper.GetBool(name)
	viper.Set(name, !flag)
	if err := viper.WriteConfig(); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}
	if err := viper.Unmarshal(&cfg); err != nil {
		return fmt.Errorf("unmarshalling config to struct : %w", err)
	}
	return nil
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
	if !viper.IsSet(name) {
		// Key doesn't exist
		return fmt.Errorf("checking if %s exists", name)
	}
	viper.Set(name, value)
	if err := viper.WriteConfig(); err != nil {
		return fmt.Errorf("failed to save configuration: %w", err)
	}
	if err := viper.Unmarshal(&cfg); err != nil {
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
	viper.SetConfigName("marasi_appconfig")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(appConfigDir)
	viper.SetDefault("first_run", true)
	viper.SetDefault("vim_enabled", true)
	viper.SetDefault("default_address", "127.0.0.1")
	viper.SetDefault("syntax_mode", "auto")
	viper.SetDefault("default_port", "8080")
	err = viper.ReadInConfig()
	if err != nil {
		// need to check if the error is config file doesn't exist
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// Config file is not found
			err = viper.SafeWriteConfig()
			if err != nil {
				return nil, fmt.Errorf("writing config file : %w", err)
			}
		} else {
			return nil, fmt.Errorf("reading config file : %w", err)
		}
	}
	var config Config
	if err := viper.Unmarshal(&config); err != nil {
		return nil, fmt.Errorf("unmarshalling config to struct : %w", err)
	}

	config.DesktopOS = runtime.GOOS
	config.ConfigDir = appConfigDir
	// Rewrite entire file from struct
	err = viper.WriteConfig()
	if err != nil {
		return nil, fmt.Errorf("writing config after unmarshalling : %w", err)
	}
	return &config, nil
}
