// Reference runner for scripts/glob-differential.ts.
package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"testing/fstest"
)

func main() {
	var req struct {
		Files    map[string]string
		Patterns []string
	}
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		panic(err)
	}
	files := fstest.MapFS{}
	for name, data := range req.Files {
		files[name] = &fstest.MapFile{Data: []byte(data)}
	}
	enc := json.NewEncoder(os.Stdout)
	for _, pattern := range req.Patterns {
		names, err := fs.Glob(files, pattern)
		result := struct {
			Names []string `json:"names"`
			Error string   `json:"error"`
		}{Names: names}
		if err != nil {
			result.Error = err.Error()
		}
		if err := enc.Encode(result); err != nil {
			panic(err)
		}
	}
}
