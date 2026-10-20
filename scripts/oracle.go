// Test-only reference process. Never shipped or invoked by the library.
package main
import("bufio";"bytes";"encoding/json";"fmt";"os";"text/template")
func normalize(v any)any {switch x:=v.(type){case json.Number:if n,e:=x.Int64();e==nil{return int(n)};n,_:=x.Float64();return n;case []any:for i,v:=range x{x[i]=normalize(v)};case map[string]any:for k,v:=range x{x[k]=normalize(v)}};return v}
func main(){scanner:=bufio.NewScanner(os.Stdin);scanner.Buffer(make([]byte,4096),1024*1024);enc:=json.NewEncoder(os.Stdout);for scanner.Scan(){func(){var q struct{Source string;Data any};dec:=json.NewDecoder(bytes.NewReader(scanner.Bytes()));dec.UseNumber();if e:=dec.Decode(&q);e!=nil{panic(e)};var b bytes.Buffer;t,e:=template.New("differential").Parse(q.Source);if e==nil{e=t.Execute(&b,normalize(q.Data))};result:=map[string]any{"output":b.String(),"ok":e==nil};if e!=nil{result["error"]=fmt.Sprint(e)};enc.Encode(result)}()}}
