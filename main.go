package main

import (
	"embed"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/build
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	opts := application.Options{
		Name: "Marasi",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(app),
		},
		ShouldQuit:   app.shouldQuit,
		ErrorHandler: handleWailsError,
		LogLevel:     slog.LevelError,
	}
	modifyOptionsForIOS(&opts)
	wails := application.New(opts)
	app.wails = wails
	quitOnSignal(app)
	if menu := applicationMenu(); menu != nil {
		wails.Menu.SetApplicationMenu(menu)
	}

	window := wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Marasi",
		Width:            1600,
		Height:           900,
		BackgroundColour: application.NewRGB(27, 38, 54),
	})
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		app.windowClosing(event.Cancel)
	})

	if err := wails.Run(); err != nil {
		println("Error:", err.Error())
	}
}
