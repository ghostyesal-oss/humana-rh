-- Le journal ne conserve plus le navigateur, le système ni le type de réseau.

update public.time_punches
set operating_system = null,
    browser_application = null,
    network_type = null
where operating_system is not null
   or browser_application is not null
   or network_type is not null;
