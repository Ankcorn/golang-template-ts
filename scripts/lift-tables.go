// Export local upstream table declarations without rewriting their contents.
package main
import("go/ast";"go/parser";"go/token";"go/format";"bytes";"os";"fmt")
func main(){source:=os.Args[len(os.Args)-1];fset:=token.NewFileSet();f,e:=parser.ParseFile(fset,source,nil,0);if e!=nil{panic(e)};wanted:=map[string]string{"TestJSEscaping":"testCases","TestIsTrue":"tests","TestEvalFieldErrors":"tests","TestInterfaceValues":"tests","TestExecutePanicDuringCall":"tests","TestFunctionCheckDuringCall":"tests"};fmt.Println("\nfunc TestExportLocalsTS(t *testing.T){tables:=map[string]any{}")
 for _,d:=range f.Decls{fn,ok:=d.(*ast.FuncDecl);if !ok{continue};table,ok:=wanted[fn.Name.Name];if !ok{continue};fmt.Println("{");for _,s:=range fn.Body.List{if _,ok:=s.(*ast.RangeStmt);ok{break};var buf bytes.Buffer;if _,ok:=s.(*ast.AssignStmt);ok{format.Node(&buf,fset,s);fmt.Println(buf.String());if fn.Name.Name=="TestExecutePanicDuringCall"&&bytes.HasPrefix(buf.Bytes(),[]byte("funcs :=")){fmt.Println("_ = funcs")}}else if _,ok:=s.(*ast.DeclStmt);ok{format.Node(&buf,fset,s);fmt.Println(buf.String())}}
 fmt.Printf("rows:=[]any{};for _,row:=range %s {v:=reflect.ValueOf(&row).Elem();fields:=map[string]any{};for i:=0;i<v.NumField();i++{fields[v.Type().Field(i).Name]=encodeValue(v.Field(i),0)};rows=append(rows,fields)};tables[%q]=rows\n}\n",table,fn.Name.Name)
 };fmt.Println(`b,e:=json.MarshalIndent(tables,"","  ");if e!=nil{t.Fatal(e)};if e=os.WriteFile(os.Getenv("TS_FIXTURES")+"/locals.json",b,0644);e!=nil{t.Fatal(e)}}`)
}
