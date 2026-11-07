package main

import "os/user"

// lookupOSUser returns the OS user's full name and login. Tests replace it.
var lookupOSUser = func() (full, login string, err error) {
	current, err := user.Current()
	if err != nil {
		return "", "", err
	}
	return current.Name, current.Username, nil
}

// OSUserName is the OS user's full name, else their login, else "User".
// Report export pre-fills Assessor with it.
func (a *App) OSUserName() string {
	full, login, err := lookupOSUser()
	switch {
	case err != nil:
		return "User"
	case full != "":
		return full
	case login != "":
		return login
	}
	return "User"
}
