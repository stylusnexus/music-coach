-- Music Coach: start the coach's small local server, then open it in Chrome.
-- Your progress lives in ~/Library/Application Support/Music Coach and your sketches
-- in ~/Music/Music Coach Sketches, so replacing the app never loses them.
-- The app stays open while the coach runs, as Apple asks of apps that start helpers:
-- Quit (Dock menu or Cmd-Q) stops the server too, and clicking it in the Dock reopens
-- the page. If the server stops some other way (Quit in About, Uninstall, or a newer
-- copy taking over), the app quits by itself.
property appURL : "http://localhost:8765/"
property thisBuild : ""
property misses : 0

on run
	try
		startCoach()
	on error
		-- Cancel on the Python message, or anything else that stopped the start.
		quit
	end try
end run

-- Opening Music Coach while it runs. The coach may have stopped (Quit in About) or the
-- app may have been replaced by a newer version: start (or restart) it as needed.
on reopen
	try
		startCoach()
	on error
		if not ownServer() then quit
	end try
end reopen

-- Start this copy's coach, stopping a coach from another copy first, then open the page.
on startCoach()
	set appDir to POSIX path of (path to me) & "Contents/Resources/app"
	set dataDir to POSIX path of (path to application support folder from user domain) & "Music Coach"
	set sketchDir to POSIX path of (path to music folder) & "Music Coach Sketches"
	set misses to 0
	-- Python 3.9 or newer: Homebrew, python.org, or Apple's own (only when its developer tools are installed,
	-- since otherwise running it pops up an installer instead).
	set py to do shell script "for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do if [ -x \"$p\" ] && \"$p\" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then echo \"$p\"; exit 0; fi; done; if xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then echo /usr/bin/python3; fi; true"
	if py is "" then
		set choice to button returned of (display dialog "Music Coach needs Python 3, which this Mac doesn't have yet. It's free: install it from python.org, then open Music Coach again. (After installing, also double-click Install Certificates in the Python folder under Applications.)" buttons {"Cancel", "Open python.org"} default button 2 with icon caution)
		if choice is "Open python.org" then open location "https://www.python.org/downloads/macos/"
		error "No Python"
	end if
	-- A coach already running from another copy of the code (the app before an update, or
	-- another copy) is stopped, so this copy's server answers.
	set thisBuild to do shell script "cd " & quoted form of appDir & " && " & quoted form of py & " server.py --build"
	-- Only a Music Coach page is ever stopped; versions before 0.3 can't say which build they are.
	set homePage to do shell script "curl -s " & appURL & " || true"
	if homePage contains "<title>Music Coach" and not ownServer() then
		do shell script "curl -s -m 5 -X POST " & appURL & "api/quit || true"
		repeat 20 times
			delay 0.25
			if not answering() then exit repeat
		end repeat
		-- Versions before 0.4 have no quit: stop the coach listening on the port.
		do shell script "lsof -ti tcp:8765 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 0.5; true"
	end if
	if not answering() then
		-- The server starts in its own subshell with nothing left on this command's output,
		-- so do shell script returns at once instead of waiting until the server stops.
		do shell script "mkdir -p " & quoted form of dataDir & " && cd " & quoted form of appDir & " && (COACH_DATA=" & quoted form of dataDir & " COACH_SKETCHES=" & quoted form of sketchDir & " nohup " & quoted form of py & " server.py > " & quoted form of (dataDir & "/server.log") & " 2>&1 < /dev/null &)"
		-- Wait up to 10 seconds for the server to answer.
		repeat 20 times
			delay 0.5
			if answering() then exit repeat
		end repeat
	end if
	openPage()
end startCoach

-- Every few seconds: is this copy's coach still running? If it stopped, or another copy
-- took over the port, this app has nothing left to do. A few misses in a row are
-- allowed, so a slow start never closes it.
on idle
	if thisBuild is "" then
		quit
		return 5
	end if
	if ownServer() then
		set misses to 0
	else
		set misses to misses + 1
		if misses ≥ 3 then quit
	end if
	return 5
end idle

-- Quit stops the coach too, but never a coach that another copy of the app started.
on quit
	if thisBuild is not "" and ownServer() then do shell script "curl -s -m 5 -X POST " & appURL & "api/quit || true"
	continue quit
end quit

on answering()
	return (do shell script "curl -s -m 2 -o /dev/null -w '%{http_code}' " & appURL & " || true") is "200"
end answering

on ownServer()
	if thisBuild is "" then return false
	return (do shell script "curl -s -m 2 " & appURL & "api/version || true") contains thisBuild
end ownServer

on openPage()
	try
		do shell script "open -a 'Google Chrome' " & appURL
	on error
		display dialog "Music Coach works best in Google Chrome: Safari can't read a MIDI keyboard. Opening your default browser for now." buttons {"OK"} default button 1
		open location appURL
	end try
end openPage
