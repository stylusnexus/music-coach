-- Music Coach: start the coach's small local server, then open it in Chrome.
-- Your progress lives in ~/Library/Application Support/Music Coach and your sketches
-- in ~/Music/Music Coach Sketches, so replacing the app never loses them.
set appDir to POSIX path of (path to me) & "Contents/Resources/app"
set dataDir to POSIX path of (path to application support folder from user domain) & "Music Coach"
set sketchDir to POSIX path of (path to music folder) & "Music Coach Sketches"
set appURL to "http://localhost:8765/"
-- Python 3.9 or newer: Homebrew, python.org, or Apple's own (only when its developer tools are installed,
-- since otherwise running it pops up an installer instead).
set py to do shell script "for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do if [ -x \"$p\" ] && \"$p\" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then echo \"$p\"; exit 0; fi; done; if xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then echo /usr/bin/python3; fi; true"
if py is "" then
	set choice to button returned of (display dialog "Music Coach needs Python 3, which this Mac doesn't have yet. It's free: install it from python.org, then open Music Coach again. (After installing, also double-click Install Certificates in the Python folder under Applications.)" buttons {"Cancel", "Open python.org"} default button 2 with icon caution)
	if choice is "Open python.org" then open location "https://www.python.org/downloads/macos/"
	return
end if
-- A coach already running from another copy of the code (the app before an update, or
-- another copy) is stopped, so this copy's server answers.
set thisBuild to do shell script "cd " & quoted form of appDir & " && " & quoted form of py & " server.py --build"
-- Only a Music Coach page is ever stopped; versions before 0.3 can't say which build they are.
set homePage to do shell script "curl -s " & appURL & " || true"
set versionReply to do shell script "curl -s " & appURL & "api/version || true"
if homePage contains "<title>Music Coach" and versionReply does not contain thisBuild then
	do shell script "curl -s -X POST " & appURL & "api/quit || true"
	repeat 20 times
		delay 0.25
		if (do shell script "curl -s -o /dev/null -w '%{http_code}' " & appURL & " || true") is not "200" then exit repeat
	end repeat
	-- Versions before 0.4 have no quit: stop the coach listening on the port.
	do shell script "lsof -ti tcp:8765 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 0.5; true"
end if
set isRunning to (do shell script "curl -s -o /dev/null -w '%{http_code}' " & appURL & " || true")
if isRunning is not "200" then
	do shell script "mkdir -p " & quoted form of dataDir & " && cd " & quoted form of appDir & " && COACH_DATA=" & quoted form of dataDir & " COACH_SKETCHES=" & quoted form of sketchDir & " nohup " & quoted form of py & " server.py > " & quoted form of (dataDir & "/server.log") & " 2>&1 &"
	-- Wait up to 10 seconds for the server to answer.
	repeat 20 times
		delay 0.5
		if (do shell script "curl -s -o /dev/null -w '%{http_code}' " & appURL & " || true") is "200" then exit repeat
	end repeat
end if
try
	do shell script "open -a 'Google Chrome' " & appURL
on error
	display dialog "Music Coach works best in Google Chrome: Safari can't read a MIDI keyboard. Opening your default browser for now." buttons {"OK"} default button 1
	open location appURL
end try
