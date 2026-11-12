package main

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Android keeps connection passwords in the app's secure storage (Wails'
// Android.Secure*: the Android Keystore), not go-keyring, which needs a
// Secret Service Android doesn't have.
func init() { platformKeychain = androidKeychain }

func androidKeychain() *keychain {
	key := func(service, account string) string { return service + ":" + account }
	return &keychain{
		set: func(service, account, secret string) error {
			return application.Android.SecureSet(key(service, account), secret)
		},
		get: func(service, account string) (string, error) {
			value, ok, err := application.Android.SecureGet(key(service, account))
			if err != nil {
				return "", err
			}
			if !ok {
				return "", fmt.Errorf("no saved password for %s", account)
			}
			return value, nil
		},
		remove: func(service, account string) error {
			return application.Android.SecureDelete(key(service, account))
		},
	}
}
